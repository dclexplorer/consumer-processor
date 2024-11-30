import { DeploymentToSqs } from '@dcl/schemas/dist/misc/deployments-to-sqs'
import { spawnSync } from 'child_process'
import fs from 'fs/promises'
import path from 'path'
import { TaskQueueMessage } from '../../adapters/sqs'
import { AppComponents } from '../../types'
import { getAllGltfsWithDependencies, getEntityDefinition } from './asset-optimizer'
import { modifyGltfToMapDependencies } from './gltf'

export async function godotOptimizer(
  entity: DeploymentToSqs,
  _msg: TaskQueueMessage,
  components: Pick<AppComponents, 'logs'>
) {
  const logger = components.logs.getLogger('godot-optimizer')

  // TODO: some sceneUrns are not using the contentServerUrls, maybe it's worth to check if is retrieveable from the sceneUrl or from a content server
  const contentBaseUrl =
    entity.contentServerUrls && entity.contentServerUrls.length > 0
      ? entity.contentServerUrls[0]
      : 'https://peer.decentraland.org/content'

  // TODO: MAYBE make this configurable (.env)
  const godotProjectPath = path.join(process.cwd(), 'dependencies', 'godot-asset-optimizer-project')

  // TODO: make this configurable (.env)
  const godotExecutable = path.join(process.cwd(), 'godot4_bin')

  const scene = await getEntityDefinition('', entity.entity.entityId, contentBaseUrl)
  const gltfs = await getAllGltfsWithDependencies(scene, contentBaseUrl, logger)

  // TODO: is this information required or useful?
  // const dependencyTimeUsed = new Map<string, number>()
  // gltfs.forEach((gltf) => {
  //   for (const dep of gltf.dependencies) {
  //     if (dep.hash === null) continue
  //     dependencyTimeUsed.set(dep.hash, (dependencyTimeUsed.get(dep.hash) || 0) + 1)
  //   }
  // })

  const godotDir = path.join(godotProjectPath, '.godot')
  await fs.rm(godotDir, { recursive: true, force: true })

  const contentDir = path.join(godotProjectPath, 'content/')
  await fs.rm(contentDir, { recursive: true, force: true })
  await fs.mkdir(contentDir, { recursive: true })

  for (const gltf of gltfs) {
    const gltfPath = path.join(contentDir, gltf.hash)
    await modifyGltfToMapDependencies(gltf.destPath, gltfPath, gltf.file, scene)

    for (const dependency of gltf.dependencies) {
      if (dependency.hash === null) {
        console.log(`Skipping ${dependency.originalUri} - no hash`)
        continue
      }

      const extension = path.extname(dependency.originalUri)

      const srcPath = path.join(process.cwd(), 'original-content', dependency.hash)
      const dependencyPath = path.join(contentDir, dependency.hash + extension)
      await fs.copyFile(srcPath, dependencyPath)
    }
  }

  const importGodotArgs = [
    '--editor',
    '--import',
    '--headless',
    '--rendering-driver',
    'opengl3',
    '--quit-after',
    '1000'
  ]

  spawnSync(godotExecutable, importGodotArgs, {
    stdio: 'inherit',
    cwd: godotProjectPath
  })

  // TODO: check if every GLTF and asset was imported correctly

  const convertionGodotArgs = ['--headless', '--rendering-driver', 'opengl3', '--quit-after', '1000']

  spawnSync(godotExecutable, convertionGodotArgs, {
    stdio: 'inherit',
    cwd: godotProjectPath
  })

  const files = await fs.readdir(contentDir)
  for (const file of files) {
    if (file.toLowerCase().endsWith('.glb') || file.toLowerCase().endsWith('.import')) {
      await fs.unlink(path.join(contentDir, file))
    }
  }

  await fs.rm(godotDir, { recursive: true, force: true })

  // TODO: check if every GLTF was converted correctly

  const reimportGodotArgs = [
    '--editor',
    '--import',
    '--headless',
    '--rendering-driver',
    'opengl3',
    '--quit-after',
    '1000'
  ]

  spawnSync(godotExecutable, reimportGodotArgs, {
    stdio: 'inherit',
    cwd: godotProjectPath
  })

  const outputFilePath = path.join(godotProjectPath, 'test.zip')
  await fs.rm(outputFilePath, { recursive: true, force: true })

  // TODO: check if every .tscn was reimported correctly

  const exportGodotArgs = [
    '--editor',
    '--headless',
    '--rendering-driver',
    'opengl3',
    '--export-pack',
    'Android',
    outputFilePath
  ]

  spawnSync(godotExecutable, exportGodotArgs, {
    stdio: 'inherit',
    cwd: godotProjectPath
  })

  // TODO: check if all the files were exported correctly

  // TODO: remove from the zip the files that are not needed
}
