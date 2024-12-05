import { Entity } from '@dcl/schemas'
import { ILoggerComponent } from '@well-known-components/interfaces'
import fs from 'fs/promises'
import path from 'path'
import { GltfDependency } from './types'

const GLB_MAGIC_NUMBER = 0x46546c67

type GltfJsonData = {
  images?: Array<{
    uri?: string
    mimeType?: string
    bufferView?: number
    name?: string
  }>
  buffers?: Array<{
    uri?: string
    byteLength: number
    name?: string
  }>
}

export async function openGltf(filePath: string): Promise<GltfJsonData> {
  // open the file
  const file = await fs.open(filePath, 'r')
  // check if the file is a glb
  const buffer = Buffer.alloc(4)
  await file.read(buffer, 0, 4, 0)
  const isGlb = buffer.readUInt32LE(0) === GLB_MAGIC_NUMBER

  let jsonData: any
  if (!isGlb) {
    jsonData = JSON.parse(await file.readFile('utf8'))
  } else {
    // Read GLB header and JSON chunk
    const headerBuffer = Buffer.alloc(12) // For version, length, and first chunk info
    await file.read(headerBuffer, 0, 12, 4) // Start at offset 4 (after magic number)

    const chunkLength = headerBuffer.readInt32LE(8)
    const jsonBuffer = Buffer.alloc(chunkLength)
    await file.read(jsonBuffer, 0, chunkLength, 20) // Start after header (20 bytes)

    jsonData = JSON.parse(jsonBuffer.toString('utf8'))
  }

  await file.close()

  return jsonData
}

export function getDependencies(
  sourcePath: string,
  gltf: GltfJsonData,
  entity: Entity,
  logger: ILoggerComponent.ILogger
): GltfDependency[] {
  const dependencies = []
  const basePath = getBaseDir(sourcePath)

  function getPath(uri: string) {
    if (basePath === '') {
      return uri
    }
    return `${basePath}/${uri}`
  }

  function getHash(filePath: string) {
    const file = entity.content.find((item) => item.file.toLowerCase() === filePath.toLowerCase())
    if (file) {
      return file.hash
    }
    logger.error(`No file found for ${filePath}`)
    return null
  }

  // Check images for external URIs
  if (gltf.images) {
    for (const image of gltf.images) {
      if (image.uri && !image.uri.startsWith('data:')) {
        dependencies.push({
          originalUri: image.uri,
          path: getPath(image.uri),
          hash: getHash(getPath(image.uri)) ?? 'dummy'
        })
      }
    }
  }

  // Check buffers for external URIs
  if (gltf.buffers) {
    for (const buffer of gltf.buffers) {
      if (buffer.uri && !buffer.uri.startsWith('data:')) {
        dependencies.push({
          originalUri: buffer.uri,
          path: getPath(buffer.uri),
          hash: getHash(getPath(buffer.uri)) ?? 'dummy'
        })
      }
    }
  }

  return dependencies
}

function getBaseDir(filePath: string): string {
  const lastSlash = filePath.lastIndexOf('/')
  if (lastSlash !== -1) {
    return filePath.substring(0, lastSlash)
  }
  return ''
}

export async function modifyGltfToMapDependencies(
  sourcePath: string,
  targetPath: string,
  originalSceneSourcePath: string,
  entity: Entity,
  logger: ILoggerComponent.ILogger,
  addExtension: boolean = true
): Promise<string> {
  // Read the GLB/GLTF file
  const gltf = await openGltf(sourcePath)

  // Open the file to check if it's GLB
  const file = await fs.open(sourcePath, 'r')
  const magicBuffer = Buffer.alloc(4)
  await file.read(magicBuffer, 0, 4, 0)
  const isGlb = magicBuffer.readUInt32LE(0) === GLB_MAGIC_NUMBER

  // Get dependencies and map them
  const dependencies = getDependencies(originalSceneSourcePath, gltf, entity, logger)

  // Create a copy of the GLTF data to modify
  const newGltf = JSON.parse(JSON.stringify(gltf))

  // Map image URIs to new paths
  if (newGltf.images) {
    for (const image of newGltf.images) {
      if (image.uri && !image.uri.startsWith('data:')) {
        const dependency = dependencies.find((d) => d.originalUri === image.uri)
        if (dependency) {
          image.uri = dependency.hash + path.extname(dependency.originalUri)
        }
      }
    }
  }

  // Map buffer URIs to new paths and adjust offsets
  let currentOffset = 0
  if (newGltf.buffers) {
    for (const buffer of newGltf.buffers) {
      if (buffer.uri && !buffer.uri.startsWith('data:')) {
        const dependency = dependencies.find((d) => d.originalUri === buffer.uri)
        if (dependency) {
          buffer.uri = dependency.hash

          // Update bufferView offsets if they exist
          if (newGltf.bufferViews) {
            for (const bufferView of newGltf.bufferViews) {
              if (bufferView.buffer === currentOffset) {
                bufferView.byteOffset = (bufferView.byteOffset || 0) + currentOffset
              }
            }
          }

          currentOffset += buffer.byteLength
        }
      }
    }
  }

  const finalPath = addExtension ? targetPath + (isGlb ? '.glb' : '.gltf') : targetPath
  if (isGlb) {
    // For GLB files, we need to preserve the binary chunk
    const headerBuffer = Buffer.alloc(12)
    await file.read(headerBuffer, 0, 12, 4)

    const jsonChunkLength = headerBuffer.readInt32LE(8)
    const binaryChunkStart = 20 + jsonChunkLength // Header (20) + JSON chunk

    // Read binary chunk header
    const binaryHeader = Buffer.alloc(8)
    await file.read(binaryHeader, 0, 8, binaryChunkStart)
    const binaryLength = binaryHeader.readInt32LE(0)

    // Read binary chunk
    const binaryData = Buffer.alloc(binaryLength)
    await file.read(binaryData, 0, binaryLength, binaryChunkStart + 8)

    // Create new GLB file
    const jsonBuffer = Buffer.from(JSON.stringify(newGltf))
    const jsonChunkPadding = (4 - (jsonBuffer.length % 4)) % 4
    const jsonChunkPaddedLength = jsonBuffer.length + jsonChunkPadding

    // Calculate total file size
    const fileLength = 20 + jsonChunkPaddedLength + 8 + binaryLength

    // Create output buffer
    const output = Buffer.alloc(fileLength)

    // Write GLB header
    output.writeUInt32LE(GLB_MAGIC_NUMBER, 0) // magic
    output.writeUInt32LE(2, 4) // version
    output.writeUInt32LE(fileLength, 8) // total length

    // Write JSON chunk header
    output.writeUInt32LE(jsonChunkPaddedLength, 12) // chunk length
    output.writeUInt32LE(0x4e4f534a, 16) // chunk type 'JSON'

    // Write JSON chunk
    jsonBuffer.copy(output, 20)

    // Write binary chunk
    binaryHeader.copy(output, 20 + jsonChunkPaddedLength)
    binaryData.copy(output, 20 + jsonChunkPaddedLength + 8)

    // Save as GLB
    await fs.writeFile(finalPath, output)
  } else {
    // Save as GLTF
    await fs.writeFile(finalPath, JSON.stringify(newGltf, null, 2))
  }

  await file.close()
  return finalPath
}
