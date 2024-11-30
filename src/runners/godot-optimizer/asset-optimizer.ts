import { ContentMapping, Entity } from '@dcl/schemas'
import { ILoggerComponent } from '@well-known-components/interfaces'
import fs from 'fs/promises'
import PQueue from 'p-queue'
import path from 'path'
import { getDependencies, openGltf } from './gltf'
import { DownloadedFile, GltfDependency, GltfJsonData, GltfWithDependencies } from './types'

/**
 * Get the entity definition for a list of pointers
 * @param pointers - The pointers to get the entity definition for
 * @returns The first item of the entities fetched
 */
export async function getEntityDefinition(
  pointer: string,
  id: string,
  contentEntitiesActiveBaseUrl: string
): Promise<Entity> {
  if (!pointer && !id) {
    throw new Error('Either pointer or id must be provided')
  }

  const body = pointer ? { pointers: [pointer] } : { ids: [id] }

  const request = await fetch(`${contentEntitiesActiveBaseUrl}/entities/active`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json'
    }
  })

  if (request.status !== 200) {
    throw new Error(`Failed to get entity assets: ${request.statusText}`)
  }

  const value = (await request.json()) as Entity[]
  if (value.length === 0) {
    throw new Error('No entity found')
  }

  return value[0]
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
      // Check if file exists and has same size
      try {
        const stats = await fs.stat(file.destPath)

        if (stats.size > 0 && !override) {
          completed++
          logger.debug(`Skipping ${file.url} - already exists with same size`)
          logger.debug(`Progress: ${completed}/${total} files downloaded (${Math.round((completed / total) * 100)}%)`)
          return
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

      completed++
      logger.debug(`Downloaded ${file.url} - ${file.destPath}`)
      logger.debug(`Progress: ${completed}/${total} files downloaded (${Math.round((completed / total) * 100)}%)`)
    })
  })

  await Promise.all(downloadPromises)

  return files
}

export async function getAllGltfsWithDependencies(
  entity: Entity,
  contentBaseUrl: string,
  originalContentDir: string,
  logger: ILoggerComponent.ILogger
): Promise<GltfWithDependencies[]> {
  const gltfs = entity.content.filter(
    (item) => item.file.toLowerCase().endsWith('.glb') || item.file.toLowerCase().endsWith('.gltf')
  )

  const gltfDownloaded = await downloadFiles(gltfs, false, contentBaseUrl, originalContentDir, logger)

  const gltfData: (DownloadedFile & { gltf: GltfJsonData })[] = await Promise.all(
    gltfDownloaded.map(async (item) => ({
      ...item,
      gltf: await openGltf(item.destPath)
    }))
  )

  type GltfWithDependency = DownloadedFile & {
    gltf: GltfJsonData
    dependencies: GltfDependency[]
  }

  const gltfWithDependencies: GltfWithDependency[] = gltfData.map((item) => ({
    ...item,
    dependencies: getDependencies(item.file, item.gltf, entity, logger)
  }))

  const dependenciesFilesContent = gltfWithDependencies.reduce((acc: GltfDependency[], gltf: GltfWithDependency) => {
    return [...acc, ...gltf.dependencies]
  }, [])

  const dependencyContent = dependenciesFilesContent
    .map((item) => {
      return entity.content.find((contentFile) => contentFile.file.toLowerCase() === item.path.toLowerCase())
    })
    .filter(($) => !!$) as ContentMapping[]

  await downloadFiles(dependencyContent, false, contentBaseUrl, originalContentDir, logger)
  return gltfWithDependencies
}
