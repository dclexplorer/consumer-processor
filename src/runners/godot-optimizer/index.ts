import { DeploymentToSqs } from '@dcl/schemas/dist/misc/deployments-to-sqs'
import fs from 'fs/promises'
import path from 'path'
import { TaskQueueMessage } from '../../adapters/sqs'
import { AppComponents } from '../../types'
import { getAllGltfsWithDependencies, getAllTextures, getEntityDefinition } from './asset-optimizer'
import { dirExists, fileExists } from './fs-helper'
import { modifyGltfToMapDependencies } from './gltf'
import { GodotEditorResult, runGodotEditor } from './run-godot-editor'
import { DownloadedFile, DownloadedGltfWithDependencies } from './types'

type GodotOptimizerState = {
  // Once we have the data to process, the conversion could be total or partial
  //  if there are errors, we will log them and continue to the next GLTF
  //  if there are fatal errors, we will log them and stop the process
  errors: string[]

  gltfs: DownloadedGltfWithDependencies[]
  dependencies: DownloadedFile[]
  dependencyTimeUsed: Map<string, number>
  textures: DownloadedFile[]
  contentFiles: string[]
  importResult: GodotEditorResult | null
  resizeResult: GodotEditorResult | null
  convertionResult: GodotEditorResult | null
  reimportResult: GodotEditorResult | null
  exportResult: GodotEditorResult | null
  fatalError: boolean

  tempDir: string
  startedAt: Date
  finishedAt: Date | null
}

export async function godotOptimizer(
  entity: DeploymentToSqs,
  _msg: TaskQueueMessage,
  components: Pick<AppComponents, 'logs' | 'config' | 'storage'>,
  maxImageSize: number = 512
): Promise<void> {
  const logger = components.logs.getLogger('godot-optimizer')
  const state: GodotOptimizerState = {
    errors: [],
    gltfs: [],
    dependencies: [],
    dependencyTimeUsed: new Map<string, number>(),
    textures: [],
    contentFiles: [],
    importResult: null,
    resizeResult: null,
    convertionResult: null,
    reimportResult: null,
    exportResult: null,
    fatalError: false,
    tempDir: await fs.mkdtemp(path.join(process.cwd(), 'temp-godot-optimizer-')),
    startedAt: new Date(),
    finishedAt: null
  }

  let zipFilePath: string | null = null

  try {
    zipFilePath = await processOptimizer(state, entity, components, maxImageSize)
  } catch (error) {
    const logger = components.logs.getLogger('godot-optimizer')
    logger.error(`Error processing job ${entity.entity.entityId}`)
    logger.error(error as any)
    state.errors.push(error as any)
  }

  try {
    // place empty gltf data to avoid filling the report with null values
    state.gltfs = state.gltfs.map((item) => ({ ...item, gltf: {} }))
    state.finishedAt = new Date()

    // Save the report to the local file system
    const reportFilePath = path.join(state.tempDir, `${entity.entity.entityId}-report.json`)
    await fs.writeFile(reportFilePath, JSON.stringify(state, null, 2))

    state.finishedAt = new Date()
    logger.info(
      `Finished processing job ${entity.entity.entityId} in ${state.finishedAt.getTime() - state.startedAt.getTime()}ms`
    )

    // Store the report and the zip file in S3
    const s3ReportFilePath = `${entity.entity.entityId}-report.json`
    const s3ZipFilePath = `${entity.entity.entityId}.zip`
    await components.storage.storeFile(s3ReportFilePath, reportFilePath)
    if (zipFilePath) {
      await components.storage.storeFile(s3ZipFilePath, zipFilePath)
      logger.info(`Stored zip file and report for job ${entity.entity.entityId} in S3`)
    } else {
      logger.info(`Stored only report for job ${entity.entity.entityId} in S3`)
    }
  } catch (error) {
    logger.error(`Error storing report for job ${entity.entity.entityId}`)
    logger.error(error as any)
  } finally {
    // Remove the temp dir
    if (state.tempDir) {
      await fs.rm(state.tempDir, { recursive: true, force: true })
    }
  }
}

async function processOptimizer(
  state: GodotOptimizerState,
  entity: DeploymentToSqs,
  components: Pick<AppComponents, 'logs' | 'config'>,
  maxImageSize?: number
): Promise<string> {
  const logger = components.logs.getLogger('godot-optimizer')

  // TODO: some sceneUrns are not using the contentServerUrls, maybe it's worth to check if is retrieveable from the sceneUrl or from a content server
  const contentBaseUrl =
    entity.contentServerUrls && entity.contentServerUrls.length > 0
      ? entity.contentServerUrls[0]
      : 'https://peer.decentraland.org/content'

  const originalGodotProjectPath =
    (await components.config.getString('GODOT_PROJECT_PATH')) ??
    path.join(process.cwd(), 'dependencies', 'godot-asset-optimizer-project')

  const godotProjectPath = path.join(state.tempDir, 'godot-project')

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
  if (!(await dirExists(originalGodotProjectPath))) {
    throw new Error('Godot project path not found')
  }

  // Check if `project.godot` exists, if this exists we asume is the right project
  if (!(await fileExists(path.join(originalGodotProjectPath, 'project.godot')))) {
    throw new Error('Godot project file not found')
  }

  // Copy the original godot project folder to the temp dir
  await fs.cp(originalGodotProjectPath, godotProjectPath, { recursive: true })

  const godotInternalDir = path.join(godotProjectPath, '.godot')
  const godotGlbScenesDir = path.join(godotProjectPath, 'glbs/')
  const godotContentDir = path.join(godotProjectPath, 'content/')

  // 1) First we fetch the entity definition to get the pointers
  logger.info(`Fetching entity definition for ${entity.entity.entityId}`)
  const scene = await getEntityDefinition(entity.entity.entityId, contentBaseUrl)
  logger.info(
    `Fetched entity definition for ${scene.id} with contentBaseUrl ${contentBaseUrl} holding ${scene.pointers.length} pointers`
  )

  // 2) Then we download all the gltfs with their dependencies
  const { gltfs, dependencies } = await getAllGltfsWithDependencies(scene, contentBaseUrl, originalContentDir, logger)
  state.gltfs = gltfs
  state.dependencies = dependencies
  gltfs.forEach((gltf) => {
    for (const dep of gltf.dependencies) {
      if (dep.hash === null) continue
      state.dependencyTimeUsed.set(dep.hash, (state.dependencyTimeUsed.get(dep.hash) || 0) + 1)
    }
  })
  logger.info(
    `Found ${gltfs.length} GLTFs with ${gltfs.reduce((acc, curr) => acc + curr.dependencies.length, 0)} dependencies and ${state.dependencyTimeUsed.size} unique dependencies.`
  )

  // Remove .godot folder
  await fs.rm(godotInternalDir, { recursive: true, force: true })

  // Clean content and glbs folders from previous runs
  await fs.rm(godotContentDir, { recursive: true, force: true })
  await fs.mkdir(godotContentDir, { recursive: true })
  await fs.rm(godotGlbScenesDir, { recursive: true, force: true })
  await fs.mkdir(godotGlbScenesDir, { recursive: true })

  // 2.b) Download all the images/textures to the content dir
  const textures = await getAllTextures(scene, contentBaseUrl, originalContentDir, logger)
  state.textures = textures

  // 3) Copy all the gltfs to the content dir and modify the dependencies to map to the hash paths
  for (const gltf of gltfs) {
    const maybeDestGltfPath = path.join(godotContentDir, gltf.hash)
    await modifyGltfToMapDependencies(gltf.destPath, maybeDestGltfPath, gltf.file, scene, logger)

    for (const dependency of gltf.dependencies) {
      if (dependency.hash === null) {
        state.errors.push(`WARNING: Skipping ${dependency.originalUri} - no hash`)
        continue
      }

      const extension = path.extname(dependency.originalUri)

      const srcPath = path.join(originalContentDir, dependency.hash)
      const dependencyPath = path.join(godotContentDir, dependency.hash + extension)
      await fs.copyFile(srcPath, dependencyPath)
    }

    state.fatalError = false
  }

  for (const texture of textures) {
    const extension = path.extname(texture.file)
    const srcPath = path.join(originalContentDir, texture.hash)
    const dependencyPath = path.join(godotContentDir, texture.hash + extension)
    await fs.copyFile(srcPath, dependencyPath)
  }

  if (state.fatalError) {
    throw new Error('There is no gltfs or assets to process')
  }

  const contentFiles = await fs.readdir(godotContentDir)
  state.contentFiles = contentFiles

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
  const importTimeout = importGltfTimeout * gltfs.length + importGltfDependenciesTimeout * state.dependencyTimeUsed.size

  const importResult = await runGodotEditor(
    godotExecutable,
    godotProjectPath,
    components,
    importGodotArgs,
    importTimeout
  )
  state.importResult = importResult

  state.fatalError = true
  for (const file of contentFiles) {
    const filePath = path.join(godotContentDir, `${file}.import`)
    if (!(await fileExists(filePath))) {
      state.errors.push(`File ${filePath} was not imported correctly`)
    } else {
      state.fatalError = false
    }
  }

  if (state.fatalError) {
    throw new Error('Imports failed')
  }

  // 4.1) Resize all the texture files
  if (maxImageSize !== undefined) {
    const resizeGodotArgs = [
      '--headless',
      '--rendering-driver',
      'opengl3',
      '--quit-after',
      '1000',
      '--resize_images',
      `${maxImageSize}`
    ]
    const resizeResult = await runGodotEditor(
      godotExecutable,
      godotProjectPath,
      components,
      resizeGodotArgs,
      importTimeout
    )
    state.resizeResult = resizeResult
  }

  // 5) Then we convert all the imported gltfs and glb to .tscn files

  const convertionGodotArgs = ['--headless', '--rendering-driver', 'opengl3', '--quit-after', '1000', '--glbs']
  const convertionResult = await runGodotEditor(
    godotExecutable,
    godotProjectPath,
    components,
    convertionGodotArgs,
    importTimeout
  )
  state.convertionResult = convertionResult

  state.fatalError = true
  for (const file of contentFiles) {
    // Check if is a gltf or glb and then check if exists the right .tscn
    if (file.endsWith('.glb') || file.endsWith('.gltf')) {
      const hashFile = file.replace('.glb', '').replace('.gltf', '')
      const tscnFilePath = path.join(godotGlbScenesDir, `${hashFile}.tscn`)
      if (!(await fileExists(tscnFilePath))) {
        state.errors.push(`File ${tscnFilePath} was not converted correctly`)
      } else {
        state.fatalError = false
      }
    }
  }

  if (state.fatalError) {
    throw new Error('Imports failed')
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

  const reimportResult = await runGodotEditor(
    godotExecutable,
    godotProjectPath,
    components,
    reimportGodotArgs,
    importTimeout
  )
  state.reimportResult = reimportResult

  // TODO: could we check if every GLTF was converted correctly?

  // Add the remaps for existing textures and dependencies
  const remapped = [...textures, ...dependencies]
  for (const file of remapped) {
    const remapPath = path.join(godotContentDir, file.hash + '.remap')
    const extension = path.extname(file.file)
    const remapContent = `[remap]\n\npath="res://${file.hash}${extension}"\n`
    await fs.writeFile(remapPath, remapContent)
  }

  // 8) Prepare export_presets.cfg to only export the needed files
  const firstPosition = 'export_files='
  const endPosition = 'include_filter='

  // Read export_presets.cfg
  const exportPresetsPath = path.join(godotProjectPath, 'export_presets.cfg')
  const exportPresetsContent = await fs.readFile(exportPresetsPath, 'utf-8')

  // Get all .tscn files from godotGlbScenesDir
  const scenes = (await fs.readdir(godotGlbScenesDir))
    .filter((file) => file.endsWith('.tscn'))
    .map((file) => `"res://glbs/${file}"`)
    .join(',')

  // Replace the content between firstPosition and endPosition
  const startIndex = exportPresetsContent.indexOf(firstPosition) + firstPosition.length
  const endIndex = exportPresetsContent.indexOf(endPosition)
  const newContent =
    exportPresetsContent.substring(0, startIndex) +
    `PackedStringArray(${scenes})\n` +
    exportPresetsContent.substring(endIndex)

  // Write the modified content back to the file
  await fs.writeFile(exportPresetsPath, newContent)

  // 9) Then we export the godot project to a zip file
  const outputFilePath = path.join(godotProjectPath, entity.entity.entityId + '-output-mobile.zip')
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
  const exportResult = await runGodotEditor(
    godotExecutable,
    godotProjectPath,
    components,
    exportGodotArgs,
    importTimeout
  )
  state.exportResult = exportResult

  // TODO: check if all the files were exported correctly

  // 10) remove from the zip the files that are not needed ???
  // TODO: it's not necessary since the loading avoid replace the existing files (project.binary, etc)

  // Copy the zip to the output folder
  await fs.copyFile(outputFilePath, path.join(state.tempDir, scene.id + '-mobile.zip'))

  state.fatalError = false
  return outputFilePath
}
