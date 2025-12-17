import { DeploymentToSqs } from '@dcl/schemas/dist/misc/deployments-to-sqs'
import fs from 'fs/promises'
import path from 'path'
import { TaskQueueMessage } from '../../adapters/sqs'
import { AppComponents } from '../../types'
import {
  getAllGltfsWithDependencies,
  getAllTextures,
  getEntityDefinition,
  validateScene,
  SceneValidationResult,
  DEFAULT_MAX_GLTF_COUNT,
  DEFAULT_MAX_CONTENT_SIZE_BYTES
} from './asset-optimizer'
import { dirExists, fileExists, removeExtension } from '../../fs-helper'
import { modifyGltfToMapDependencies } from './gltf'
import { GodotEditorResult, runGodotEditor } from './run-godot-editor'
import { DownloadedFile, DownloadedGltfWithDependencies, FileKeyAndPath } from './types'
import { getFileSizeAsync } from './file-format'

type GodotOptimizerState = {
  // Once we have the data to process, the conversion could be total or partial
  //  if there are errors, we will log them and continue to the next GLTF
  //  if there are fatal errors, we will log them and stop the process
  errors: string[]

  // Scene validation result
  validation: SceneValidationResult | null

  gltfs: DownloadedGltfWithDependencies[]
  dependencies: DownloadedFile[]
  dependencyTimeUsed: Map<string, number>
  textures: DownloadedFile[]
  contentFiles: string[]
  importResult: GodotEditorResult | null
  resizeResult: GodotEditorResult | null
  convertionResult: GodotEditorResult | null
  reimportResult: GodotEditorResult | null
  exportResult: GodotEditorResult[] | null
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
  const tempBaseDir = path.join(process.cwd(), 'temp')
  const exists = await dirExists(tempBaseDir)
  if (!exists) {
    await fs.mkdir(tempBaseDir)
  }
  const state: GodotOptimizerState = {
    errors: [],
    validation: null,
    gltfs: [],
    dependencies: [],
    dependencyTimeUsed: new Map<string, number>(),
    textures: [],
    contentFiles: [],
    importResult: null,
    resizeResult: null,
    convertionResult: null,
    reimportResult: null,
    exportResult: [],
    fatalError: false,
    tempDir: tempBaseDir, // await fs.mkdtemp(path.join(process.cwd(), 'temp', 'temp-godot-optimizer-')),
    startedAt: new Date(),
    finishedAt: null
  }

  let files: FileKeyAndPath[] | null = null

  try {
    files = await processOptimizer(state, entity, components, maxImageSize)
  } catch (error) {
    const logger = components.logs.getLogger('godot-optimizer')
    logger.error(`Error processing job ${entity.entity.entityId}`)
    logger.error(error as any)
    // Push error message as string (Error objects serialize to {} in JSON)
    state.errors.push(error instanceof Error ? error.message : String(error))
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
    await components.storage.storeFile(s3ReportFilePath, reportFilePath)

    if (files) {
      await components.storage.storeFiles(files)
      logger.info(`Stored zip file and report for job ${entity.entity.entityId} in S3`)
    } else {
      logger.info(`Stored only report for job ${entity.entity.entityId} in S3`)
    }
  } catch (error) {
    logger.error(`Error storing report for job ${entity.entity.entityId}`)
    logger.error(error as any)
  } finally {
    // Remove the temp dir
    /*if (state.tempDir) {
      await fs.rm(state.tempDir, { recursive: true, force: true })
    }*/
  }
}

async function processOptimizer(
  state: GodotOptimizerState,
  entity: DeploymentToSqs,
  components: Pick<AppComponents, 'logs' | 'config'>,
  maxImageSize?: number
): Promise<FileKeyAndPath[]> {
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

  // Check if `project.godot` exists, if this exists we assume it's the right project
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
  const sceneId = entity.entity.entityId
  const scene = await getEntityDefinition(entity.entity.entityId, contentBaseUrl)
  logger.info(
    `Fetched entity definition for ${sceneId} with contentBaseUrl ${contentBaseUrl} holding ${scene.pointers.length} pointers`
  )

  // 1.b) Validate scene size and complexity before processing
  const maxGltfCount = parseInt((await components.config.getString('MAX_GLTF_COUNT')) ?? '', 10) || DEFAULT_MAX_GLTF_COUNT
  const maxContentSizeBytes =
    parseInt((await components.config.getString('MAX_CONTENT_SIZE_BYTES')) ?? '', 10) || DEFAULT_MAX_CONTENT_SIZE_BYTES

  const validation = await validateScene(scene, contentBaseUrl, logger, maxGltfCount, maxContentSizeBytes)
  state.validation = validation

  if (!validation.isValid) {
    state.fatalError = true
    for (const error of validation.errors) {
      state.errors.push(error)
      logger.error(`Scene validation failed: ${error}`)
    }
    throw new Error(`Scene validation failed: ${validation.errors.join('; ')}`)
  }

  // 2) Then we download all the gltfs with their dependencies
  const { gltfs, dependencies } = await getAllGltfsWithDependencies(scene, contentBaseUrl, originalContentDir, logger)
  state.gltfs = gltfs
  state.dependencies = dependencies
  gltfs.forEach((gltf) => {
    for (const dep of gltf.dependencies) {
      if (dep.hash.exist) {
        state.dependencyTimeUsed.set(dep.hash.value, (state.dependencyTimeUsed.get(dep.hash.value) || 0) + 1)
      }
    }
  })
  logger.info(
    `Found ${gltfs.length} GLTFs with ${gltfs.reduce((acc, curr) => acc + curr.dependencies.length, 0)} dependencies and ${
      state.dependencyTimeUsed.size
    } unique dependencies.`
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
      if (!dependency.hash.exist) {
        state.errors.push(`WARNING: Skipping ${dependency.originalUri} - no hash`)
        continue
      }

      const extension = path.extname(dependency.originalUri)
      const srcPath = path.join(originalContentDir, dependency.hash.value)
      const dependencyPath = path.join(godotContentDir, dependency.hash.value + extension)
      await fs.copyFile(srcPath, dependencyPath)
    }
  }

  for (const texture of textures) {
    const srcPath = path.join(originalContentDir, texture.hash)
    const dependencyPath = path.join(godotContentDir, `${texture.hash}.${texture.detectedFormat}`)
    await fs.copyFile(srcPath, dependencyPath)
  }

  // Check if there's anything to process (GLTFs or textures)
  if (gltfs.length === 0 && textures.length === 0) {
    throw new Error('There are no gltfs or textures to process')
  }

  const contentFiles = await fs.readdir(godotContentDir)
  state.contentFiles = contentFiles

  // 4) Then we import all the gltfs to the godot project
  const importGodotArgs = ['--editor', '--import', '--headless', '--rendering-driver', 'opengl3']
  const importGltfTimeout = 20000
  const importGltfDependenciesTimeout = 10000
  const baseTimeout = 30000 // Base timeout for textures and basic operations
  const importTimeout =
    baseTimeout + importGltfTimeout * gltfs.length + importGltfDependenciesTimeout * state.dependencyTimeUsed.size

  const importResult = await runGodotEditor(
    godotExecutable,
    godotProjectPath,
    components,
    importGodotArgs,
    importTimeout
  )
  state.importResult = importResult

  // Check if GLTF imports succeeded (only if we have GLTFs)
  if (gltfs.length > 0) {
    state.fatalError = true
    for (const file of contentFiles) {
      const filePath = path.join(godotContentDir, `${file}.import`)
      if (!file.endsWith('.bin') && !(await fileExists(filePath))) {
        state.errors.push(`File ${filePath} was not imported correctly`)
      } else {
        state.fatalError = false
      }
    }

    if (state.fatalError) {
      throw new Error('Imports failed')
    }
  }

  // 4.1) Resize all the texture files
  const originalSizesRelativePath = `${sceneId}-original-sizes.json`
  if (maxImageSize !== undefined) {
    const resizeGodotArgs = [
      '--headless',
      '--rendering-driver',
      'opengl3',
      '--resize_images',
      `${maxImageSize}`,
      `${originalSizesRelativePath}`
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
  const convertionGodotArgs = ['--headless', '--rendering-driver', 'opengl3', '--glbs']
  const convertionResult = await runGodotEditor(
    godotExecutable,
    godotProjectPath,
    components,
    convertionGodotArgs,
    importTimeout
  )
  state.convertionResult = convertionResult

  // Check if GLTF to TSCN conversion succeeded (only if we have GLTFs)
  if (gltfs.length > 0) {
    state.fatalError = true
    for (const file of contentFiles) {
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
      throw new Error('GLTF to TSCN conversion failed')
    }
  }

  // 6) Then we remove all the imported gltfs and glb files, leaving only the .tscn files and their dependencies
  const files = await fs.readdir(godotContentDir)
  for (const file of files) {
    if (
      file.toLowerCase().endsWith('.glb') ||
      file.toLowerCase().endsWith('.gltf') ||
      file.toLowerCase().endsWith('.import')
    ) {
      const fileToRemove = path.join(godotContentDir, file)
      await fs.unlink(fileToRemove)
    }
  }

  await fs.rm(godotInternalDir, { recursive: true, force: true })

  // 7) Then we reimport all the .tscn files to the godot project
  const reimportGodotArgs = ['--editor', '--import', '--headless', '--rendering-driver', 'opengl3']
  const reimportResult = await runGodotEditor(
    godotExecutable,
    godotProjectPath,
    components,
    reimportGodotArgs,
    importTimeout
  )
  state.reimportResult = reimportResult

  // Add the remaps for existing textures and dependencies
  const remapped = [...textures, ...dependencies]
  for (const file of remapped) {
    const remapPath = path.join(godotContentDir, file.hash + '.remap')
    const extension = file.detectedFormat
    const remapContent = `[remap]\n\npath="res://content/${file.hash}.${extension}"\n`
    await fs.writeFile(remapPath, remapContent)

    if (file.detectedFormat !== file.originalFileExtension) {
      const remapPath = path.join(godotContentDir, `${file.hash}.${file.originalFileExtension}.remap`)
      await fs.writeFile(remapPath, remapContent)
    }
  }

  // Read export_presets.cfg
  const exportPresetsPath = path.join(godotProjectPath, 'export_presets.cfg')
  const exportPresetsContent = await fs.readFile(exportPresetsPath, 'utf-8')

  const outputFilePaths: FileKeyAndPath[] = []
  const externalSceneDependencies: Record<string, string[]> = {}

  // 8) Map dependencies and export GLTFs (only if we have GLTFs)
  if (gltfs.length > 0) {
    const dependenciesRelativePath = `glbs/${sceneId}-dependencies-map.json`

    const dependenciesGodotArgs = [
      '--headless',
      '--rendering-driver',
      'opengl3',
      '--compute-dependencies',
      dependenciesRelativePath
    ]
    const dependenciesResult = await runGodotEditor(
      godotExecutable,
      godotProjectPath,
      components,
      dependenciesGodotArgs,
      importTimeout
    )
    if (dependenciesResult.error) {
      state.errors.push(`Dependencies failed: ${dependenciesResult.error}`)
    }

    const dependenciesPath = path.join(godotProjectPath, dependenciesRelativePath)
    const gltfDependencies: Record<string, string[]> = JSON.parse(await fs.readFile(dependenciesPath, 'utf-8'))

    // Get all .tscn files from godotGlbScenesDir
    const glbSceneIds = (await fs.readdir(godotGlbScenesDir))
      .filter((file) => file.endsWith('.tscn'))
      .map((file) => file.replace(/\.tscn$/, ''))

    // 9) Export each scene to a zip file
    for (const glbSceneId of glbSceneIds) {
      const scenePath = `"res://glbs/${glbSceneId}.tscn"`
      const dependencies = gltfDependencies[`${glbSceneId}.tscn`].map((s) => `"${s}"`)
      const remapDependencies = gltfDependencies[`${glbSceneId}.tscn`].map((s) => `"${removeExtension(s)}.remap"`)
      const sceneDependencies = [...dependencies, ...remapDependencies]

      // remove external dependencies on the export
      const internalSceneDependencies = sceneDependencies.filter((s) => s.includes(glbSceneId))
      const includedResources = [scenePath, ...internalSceneDependencies].join(',')

      // get external dependencies
      const externalDependencies = dependencies
        .filter((m) => !m.includes(glbSceneId))
        .map((m) => {
          const fileName = m.split('/').pop() || ''
          return fileName.split('.').shift() || ''
        })

      const excludeResources = externalDependencies.map((s) => `*${s}*`).join(',')

      await exportResource(
        glbSceneId,
        includedResources,
        excludeResources,
        exportPresetsContent,
        godotProjectPath,
        godotExecutable,
        importTimeout,
        components,
        state,
        outputFilePaths
      )

      externalSceneDependencies[glbSceneId] = externalDependencies
    }
  }

  // 10) Export each individual texture to a zip file
  for (const texture of textures) {
    const { file, hash, detectedFormat, originalFileExtension } = texture
    let resourcePath = `"res://content/${hash}.${detectedFormat}","res://content/${hash}.remap"`

    if (detectedFormat !== originalFileExtension) {
      resourcePath += `,"res://content/${hash}.${originalFileExtension}.remap"`
    }

    logger.log(`Texture export: ${resourcePath} ${file} ${hash}`)

    await exportResource(
      hash,
      resourcePath,
      '', // no excluded resources
      exportPresetsContent,
      godotProjectPath,
      godotExecutable,
      importTimeout,
      components,
      state,
      outputFilePaths
    )
  }

  // 11) Export scene metadata file
  const originalSizesPath = path.join(godotProjectPath, originalSizesRelativePath)
  const originalSizes: Record<string, string[]> = JSON.parse(await fs.readFile(originalSizesPath, 'utf-8'))

  // Save metadata
  const hashes = outputFilePaths.map((v) => v.originalHash)
  const hashSizeMap: Record<string, number> = outputFilePaths.reduce(
    (acc, file) => {
      acc[file.originalHash] = file.size
      return acc
    },
    {} as Record<string, number>
  )
  const metadataPath = path.join(godotProjectPath, `${sceneId}-optimized.json`)
  const metadata = {
    optimizedContent: hashes,
    externalSceneDependencies,
    originalSizes,
    hashSizeMap
  }
  const jsonString = JSON.stringify(metadata)
  await fs.writeFile(metadataPath, jsonString)

  // Export metadata and dependencies map
  const resourcePath = `"res://${sceneId}-optimized.json"`

  await exportResource(
    sceneId,
    resourcePath,
    '', // no exlude resources
    exportPresetsContent,
    godotProjectPath,
    godotExecutable,
    importTimeout,
    components,
    state,
    outputFilePaths
  )

  state.fatalError = false
  return outputFilePaths
}

async function exportResource(
  hash: string,
  includedResources: string,
  excludeResources: string,
  exportPresetsContent: string,
  godotProjectPath: string,
  godotExecutable: string,
  importTimeout: number,
  components: Pick<AppComponents, 'logs' | 'config'>,
  state: GodotOptimizerState,
  outputFilePaths: FileKeyAndPath[]
): Promise<void> {
  const exportPresetsPath = path.join(godotProjectPath, 'export_presets.cfg')
  const fileName = `${hash}-mobile.zip`
  const logger = components.logs.getLogger('godot-optimizer')

  logger.info(`includedResources: ${includedResources}`)

  // Replace the "export_files" and "exclude_filter" line
  const newContent = exportPresetsContent
    .replace(/export_files=.*\n/, `export_files=PackedStringArray(${includedResources})\n`)
    .replace(/exclude_filter=.*\n/, `exclude_filter="${excludeResources}"\n`)

  // Write the updated content back to the file
  await fs.writeFile(exportPresetsPath, newContent)

  const outputFilePath = path.join(godotProjectPath, fileName)
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

  //cleanZipFileFromGodotGarbage(outputFilePath)

  state.exportResult?.push(exportResult)

  logger.info(`Result: ${JSON.stringify(exportResult)}`)
  outputFilePaths.push({
    key: fileName,
    originalHash: hash,
    filePath: outputFilePath,
    size: await getFileSizeAsync(outputFilePath)
  })
}
