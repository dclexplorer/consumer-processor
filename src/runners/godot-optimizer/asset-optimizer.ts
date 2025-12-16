import { ContentMapping, Entity } from '@dcl/schemas'
import { ILoggerComponent } from '@well-known-components/interfaces'
import fs from 'fs/promises'
import PQueue from 'p-queue'
import path from 'path'
import { getDependencies, openGltf } from './gltf'
import { DownloadedFile, DownloadedGltf, DownloadedGltfWithDependencies, GltfDependency } from './types'
import { detectFormat, getExtension, isImageFormat } from './file-format'

// Scene limits to prevent processing extremely large scenes
export const DEFAULT_MAX_GLTF_COUNT = 200
export const DEFAULT_MAX_CONTENT_SIZE_BYTES = 1024 * 1024 * 1024 // 1GB

export type SceneValidationResult = {
  isValid: boolean
  gltfCount: number
  totalFiles: number
  estimatedSizeBytes: number
  errors: string[]
}

/**
 * Estimate the total content size by checking Content-Length headers
 * Uses sampling for large scenes to avoid too many HEAD requests
 */
export async function estimateContentSize(
  content: ContentMapping[],
  contentBaseUrl: string,
  logger: ILoggerComponent.ILogger
): Promise<number> {
  const uniqueHashes = [...new Set(content.map((c) => c.hash))]

  // For very large scenes, sample to estimate
  const MAX_SAMPLE = 100
  const samplesToCheck = uniqueHashes.length > MAX_SAMPLE ? uniqueHashes.slice(0, MAX_SAMPLE) : uniqueHashes

  const queue = new PQueue({ concurrency: 10 })
  let totalSampleSize = 0

  await Promise.all(
    samplesToCheck.map((hash) =>
      queue.add(async () => {
        try {
          const response = await fetch(`${contentBaseUrl}/contents/${hash}`, { method: 'HEAD' })
          const contentLength = response.headers.get('content-length')
          if (contentLength) {
            totalSampleSize += parseInt(contentLength, 10)
          }
        } catch (error) {
          logger.debug(`Failed to get size for ${hash}: ${error}`)
        }
      })
    )
  )

  // Extrapolate if we sampled
  if (uniqueHashes.length > MAX_SAMPLE) {
    const avgSize = totalSampleSize / samplesToCheck.length
    return avgSize * uniqueHashes.length
  }

  return totalSampleSize
}

/**
 * Validate scene before processing - checks GLTF count and estimated size
 */
export async function validateScene(
  entity: Entity,
  contentBaseUrl: string,
  logger: ILoggerComponent.ILogger,
  maxGltfCount: number = DEFAULT_MAX_GLTF_COUNT,
  maxContentSizeBytes: number = DEFAULT_MAX_CONTENT_SIZE_BYTES
): Promise<SceneValidationResult> {
  const errors: string[] = []

  const gltfs = entity.content.filter(
    (item) => item.file.toLowerCase().endsWith('.glb') || item.file.toLowerCase().endsWith('.gltf')
  )
  const gltfCount = gltfs.length
  const totalFiles = entity.content.length

  logger.info(`Scene validation: ${gltfCount} GLTFs, ${totalFiles} total files`)

  // Check GLTF count
  if (gltfCount > maxGltfCount) {
    errors.push(`Scene has ${gltfCount} GLTFs, exceeds maximum of ${maxGltfCount}`)
  }

  // Estimate content size
  logger.info('Estimating content size...')
  const estimatedSizeBytes = await estimateContentSize(entity.content, contentBaseUrl, logger)
  const estimatedSizeMB = estimatedSizeBytes / 1024 / 1024
  logger.info(`Estimated content size: ${estimatedSizeMB.toFixed(2)} MB`)

  // Check content size
  if (estimatedSizeBytes > maxContentSizeBytes) {
    errors.push(
      `Scene estimated size is ${estimatedSizeMB.toFixed(2)} MB, exceeds maximum of ${maxContentSizeBytes / 1024 / 1024} MB`
    )
  }

  return {
    isValid: errors.length === 0,
    gltfCount,
    totalFiles,
    estimatedSizeBytes,
    errors
  }
}

/**
 * Get the entity definition for a list of pointers
 * @param pointers - The pointers to get the entity definition for
 * @returns The first item of the entities fetched
 */
export async function getEntityDefinition(id: string, contentContentFilesBaseUrl: string): Promise<Entity> {
  const request = await fetch(`${contentContentFilesBaseUrl}/contents/${id}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json'
    }
  })

  if (request.status !== 200) {
    throw new Error(`Failed to get entity assets: ${request.statusText}`)
  }

  const value = (await request.json()) as Entity
  return value
}

export async function downloadFiles(
  content: ContentMapping[],
  override = false,
  contentContentFilesBaseUrl: string,
  originalContentDir: string,
  logger: ILoggerComponent.ILogger
): Promise<DownloadedFile[]> {
  const files = content.map((file) => ({
    ...file,
    url: `${contentContentFilesBaseUrl}/contents/${file.hash}`,
    destPath: path.join(originalContentDir, file.hash)
  }))

  const MAX_CONCURRENT = 5
  const queue = new PQueue({ concurrency: MAX_CONCURRENT })

  let completed = 0
  const total = files.length

  const downloadPromises = files.map((file) => {
    return queue.add(async () => {
      let success = false
      try {
        // Check if file exists and has same size
        try {
          const stats = await fs.stat(file.destPath)

          if (stats.size > 0 && !override) {
            logger.debug(`Skipping ${file.url} - already exists with same size`)
            const detectedFormat = await detectFormat(file.destPath, file.file)
            const originalFileExtension = getExtension(file.file)

            if (detectedFormat !== originalFileExtension) {
              logger.info(
                `${file.file} ${file.hash} different extension orig=${originalFileExtension} vs detected=${detectedFormat}`
              )
            }
            return { ...file, originalFileExtension, detectedFormat, success: true }
          }
        } catch (error) {
          // File doesn't exist, continue with download
        }

        const response = await fetch(file.url)

        if (response.status !== 200) {
          throw new Error(`Failed to download file ${file.url}: ${response.statusText}`)
        }

        const buffer = await response.arrayBuffer()
        await fs.mkdir(path.dirname(file.destPath), { recursive: true })
        await fs.writeFile(file.destPath, Buffer.from(buffer))

        logger.debug(`Downloaded ${file.url} - ${file.destPath}`)
        success = true
      } catch (error) {
        logger.error(`Error downloading ${file.url}: ${error}`)
      } finally {
        completed++
        logger.debug(`Progress: ${completed}/${total} files downloaded (${Math.round((completed / total) * 100)}%)`)
      }

      const detectedFormat = await detectFormat(file.destPath, file.file)
      const originalFileExtension = getExtension(file.file)
      if (detectedFormat !== originalFileExtension) {
        logger.info(
          `${file.file} ${file.hash} different extension orig=${originalFileExtension} vs detected=${detectedFormat}`
        )
      }

      return { ...file, success, detectedFormat, originalFileExtension } satisfies DownloadedFile
    })
  })

  const results = (await Promise.all(downloadPromises)) as DownloadedFile[]

  return results
}

export async function getAllGltfsWithDependencies(
  entity: Entity,
  contentBaseUrl: string,
  originalContentDir: string,
  logger: ILoggerComponent.ILogger
): Promise<{
  gltfs: DownloadedGltfWithDependencies[]
  dependencies: DownloadedFile[]
}> {
  const gltfs = entity.content.filter(
    (item) => item.file.toLowerCase().endsWith('.glb') || item.file.toLowerCase().endsWith('.gltf')
  )

  const gltfDownloaded = await downloadFiles(gltfs, false, contentBaseUrl, originalContentDir, logger)

  const gltfData: DownloadedGltf[] = await Promise.all(
    gltfDownloaded.map(async (item) => ({
      ...item,
      gltf: await openGltf(item.destPath)
    }))
  )
  const gltfWithDependencies: DownloadedGltfWithDependencies[] = gltfData.map((item) => ({
    ...item,
    dependencies: getDependencies(item.file, item.gltf, entity, logger)
  }))

  const dependenciesFilesContent = gltfWithDependencies.reduce(
    (acc: GltfDependency[], gltf: DownloadedGltfWithDependencies) => {
      return [...acc, ...gltf.dependencies]
    },
    []
  )

  const dependencyContent = dependenciesFilesContent
    .map((item) => {
      return entity.content.find((contentFile) => contentFile.file.toLowerCase() === item.path.toLowerCase())
    })
    .filter(($) => !!$) as ContentMapping[]

  const dependenciesDownloaded = await downloadFiles(
    dependencyContent,
    false,
    contentBaseUrl,
    originalContentDir,
    logger
  )

  return {
    gltfs: gltfWithDependencies,
    dependencies: dependenciesDownloaded
  }
}

export async function getAllTextures(
  entity: Entity,
  contentBaseUrl: string,
  originalContentDir: string,
  logger: ILoggerComponent.ILogger
): Promise<DownloadedFile[]> {
  const images = entity.content.filter((item) => isImageFormat(item.file))

  const imagesDownloaded = await downloadFiles(images, false, contentBaseUrl, originalContentDir, logger)
  return imagesDownloaded
}
