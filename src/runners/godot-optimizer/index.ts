import { DeploymentToSqs } from '@dcl/schemas/dist/misc/deployments-to-sqs'
import fs from 'fs/promises'
import path from 'path'
import { TaskQueueMessage } from '../../adapters/sqs'
import { AppComponents } from '../../types'
import { getAllGltfsWithDependencies, getEntityDefinition } from './asset-optimizer'
import { dirExists, fileExists } from './fs-helper'
import { modifyGltfToMapDependencies } from './gltf'
import { runGodotEditor } from './run-godot-editor'

export async function godotOptimizer(
  entity: DeploymentToSqs,
  _msg: TaskQueueMessage,
  components: Pick<AppComponents, 'logs' | 'config'>
) {
  const logger = components.logs.getLogger('godot-optimizer')

  // TODO: some sceneUrns are not using the contentServerUrls, maybe it's worth to check if is retrieveable from the sceneUrl or from a content server
  const contentBaseUrl =
    entity.contentServerUrls && entity.contentServerUrls.length > 0
      ? entity.contentServerUrls[0]
      : 'https://peer.decentraland.org/content'

  const godotProjectPath =
    (await components.config.getString('GODOT_PROJECT_PATH')) ??
    path.join(process.cwd(), 'dependencies', 'godot-asset-optimizer-project')

  const godotExecutable =
    (await components.config.getString('GODOT4_EDITOR')) ?? path.join(process.cwd(), 'godot4_editor')

  // TODO: should it be cleaned before each run? or have a disk space limit?
  const originalContentDir =
    (await components.config.getString('DOWNLOAD_CONTENT_FOLDER')) ?? path.join(process.cwd(), 'original-content')

  // Check if the godotExecutable exists
  if (!(await fileExists(godotExecutable))) {
    throw new Error('Godot executable not found')
  }

  // Check if the godotProjectPath exists
  if (!(await dirExists(godotProjectPath))) {
    throw new Error('Godot project path not found')
  }

  // Check if `project.godot` exists, if this exists we asume is the right project
  if (!(await fileExists(path.join(godotProjectPath, 'project.godot')))) {
    throw new Error('Godot project file not found')
  }

  // 1) First we fetch the entity definition to get the pointers
  logger.info(`Fetching entity definition for ${entity.entity.entityId}`)
  const scene = await getEntityDefinition('', entity.entity.entityId, contentBaseUrl)
  logger.info(
    `Fetched entity definition for ${scene.id} with contentBaseUrl ${contentBaseUrl} holding ${scene.pointers.length} pointers`
  )

  // 2) Then we download all the gltfs with their dependencies
  const gltfs = await getAllGltfsWithDependencies(scene, contentBaseUrl, originalContentDir, logger)
  const dependencyTimeUsed = new Map<string, number>()
  gltfs.forEach((gltf) => {
    for (const dep of gltf.dependencies) {
      if (dep.hash === null) continue
      dependencyTimeUsed.set(dep.hash, (dependencyTimeUsed.get(dep.hash) || 0) + 1)
    }
  })
  logger.info(
    `Found ${gltfs.length} GLTFs with ${gltfs.reduce((acc, curr) => acc + curr.dependencies.length, 0)} dependencies and ${dependencyTimeUsed.size} unique dependencies.`
  )

  const godotInternalDir = path.join(godotProjectPath, '.godot')
  await fs.rm(godotInternalDir, { recursive: true, force: true })

  const godotGlbScenesDir = path.join(godotProjectPath, 'glbs/')
  const godotContentDir = path.join(godotProjectPath, 'content/')
  await fs.rm(godotContentDir, { recursive: true, force: true })
  await fs.mkdir(godotContentDir, { recursive: true })

  // Once we have the data to process, the conversion could be total or partial
  //  if there are errors, we will log them and continue to the next GLTF
  //  if there are fatal errors, we will log them and stop the process
  const errors: string[] = []
  let fatalError = false

  // 3) Copy all the gltfs to the content dir and modify the dependencies to map to the hash paths
  for (const gltf of gltfs) {
    const maybeDestGltfPath = path.join(godotContentDir, gltf.hash)
    await modifyGltfToMapDependencies(gltf.destPath, maybeDestGltfPath, gltf.file, scene, logger)

    for (const dependency of gltf.dependencies) {
      if (dependency.hash === null) {
        errors.push(`WARNING: Skipping ${dependency.originalUri} - no hash`)
        continue
      }

      const extension = path.extname(dependency.originalUri)

      const srcPath = path.join(originalContentDir, dependency.hash)
      const dependencyPath = path.join(godotContentDir, dependency.hash + extension)
      await fs.copyFile(srcPath, dependencyPath)
    }

    fatalError = false
  }

  if (fatalError) {
    throw new Error('There is no gltfs or assets to process')
  }

  const contentFiles = await fs.readdir(godotContentDir)

  // 4) Then we import all the gltfs to the godot project
  const importGodotArgs = [
    '--editor',
    '--import',
    '--headless',
    '--rendering-driver',
    'opengl3',
    '--quit-after',
    '1000'
  ]
  const importGltfTimeout = 20000
  const importGltfDependenciesTimeout = 10000
  const importTimeout = importGltfTimeout * gltfs.length + importGltfDependenciesTimeout * dependencyTimeUsed.size

  const importResult = await runGodotEditor(
    godotExecutable,
    godotProjectPath,
    components,
    importGodotArgs,
    importTimeout
  )

  fatalError = true
  for (const file of contentFiles) {
    const filePath = path.join(godotContentDir, `${file}.import`)
    if (!(await fileExists(filePath))) {
      errors.push(`File ${filePath} was not imported correctly`)
    } else {
      fatalError = false
    }
  }

  if (fatalError) {
    logger.error(`Import failed with errors: ${errors.join('\n\t- ')}`)
    logger.error(
      `Import result: error ${importResult.error} \n\t stderr: ${importResult.stderr} \n\t stdout: ${importResult.stdout}`
    )
    throw new Error('Imports failed')
  }

  // 5) Then we convert all the imported gltfs and glb to .tscn files

  await fs.rm(godotGlbScenesDir, { recursive: true, force: true })
  await fs.mkdir(godotGlbScenesDir, { recursive: true })

  const convertionGodotArgs = ['--headless', '--rendering-driver', 'opengl3', '--quit-after', '1000']
  const convertionResult = await runGodotEditor(
    godotExecutable,
    godotProjectPath,
    components,
    convertionGodotArgs,
    importTimeout
  )

  fatalError = true
  for (const file of contentFiles) {
    // Check if is a gltf or glb and then check if exists the right .tscn
    if (file.endsWith('.glb') || file.endsWith('.gltf')) {
      const tscnFilePath = path.join(godotGlbScenesDir, `${file}.tscn`)
      if (!(await fileExists(tscnFilePath))) {
        errors.push(`File ${tscnFilePath} was not converted correctly`)
      } else {
        fatalError = false
      }
    }
  }

  if (fatalError) {
    logger.error(`Conversion failed with errors: ${errors.join('\n\t- ')}`)
    logger.error(
      `Convert result: error ${convertionResult.error} \n\t stderr: ${convertionResult.stderr} \n\t stdout: ${convertionResult.stdout}`
    )
    logger.error(
      `Import result: error ${importResult.error} \n\t stderr: ${importResult.stderr} \n\t stdout: ${importResult.stdout}`
    )
    throw new Error('Conversion failed')
  }

  // 6) Then we remove all the imported gltfs and glb files, leaving only the .tscn files and their dependencies
  const files = await fs.readdir(godotContentDir)
  for (const file of files) {
    if (
      file.toLowerCase().endsWith('.glb') ||
      file.toLowerCase().endsWith('.gltf') ||
      file.toLowerCase().endsWith('.import')
    ) {
      await fs.unlink(path.join(godotContentDir, file))
    }
  }

  await fs.rm(godotInternalDir, { recursive: true, force: true })

  // 7) Then we reimport all the .tscn files to the godot project
  const reimportGodotArgs = [
    '--editor',
    '--import',
    '--headless',
    '--rendering-driver',
    'opengl3',
    '--quit-after',
    '1000'
  ]

  await runGodotEditor(godotExecutable, godotProjectPath, components, reimportGodotArgs, importTimeout)

  // TODO: could we check if every GLTF was converted correctly?

  // 8) Prepare export_presets.cfg to only export the needed files
  // TODO

  // 9) Then we export the godot project to a zip file
  const outputFilePath = path.join(godotProjectPath, 'test.zip')
  const exportGodotArgs = [
    '--editor',
    '--headless',
    '--rendering-driver',
    'opengl3',
    '--export-pack',
    'Android',
    outputFilePath
  ]

  await fs.rm(outputFilePath, { recursive: true, force: true })
  await runGodotEditor(godotExecutable, godotProjectPath, components, exportGodotArgs, importTimeout)

  // TODO: check if all the files were exported correctly

  // 10) remove from the zip the files that are not needed ???
  // TODO: it's not necessary since the loading avoid replace the existing files (project.binary, etc)
}
