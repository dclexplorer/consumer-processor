// Types for asset-optimizer.ts
export type EntityDefinition = {
  id: string
  content: ContentItem[]
}

export type ContentItem = {
  file: string
  hash: string
}

export type DownloadedFile = ContentItem & {
  url: string
  destPath: string
  detectedFormat: string
  originalFileExtension: string
  success: boolean
}

// Types for GLTF-related structures
export type GltfImage = {
  uri?: string
  mimeType?: string
  bufferView?: number
  name?: string
}

export type GltfBuffer = {
  uri?: string
  byteLength: number
  name?: string
}

export type GltfJsonData = {
  images?: GltfImage[]
  buffers?: GltfBuffer[]
}

export type GltfDependency = {
  originalUri: string
  path: string
  hash: { exist: true; value: string } | { exist: false; value: null }
}

export type DownloadedGltf = DownloadedFile & {
  gltf: GltfJsonData
}

export type DownloadedGltfWithDependencies = DownloadedGltf & {
  dependencies: GltfDependency[]
}

export type FileKeyAndPath = { key: string; originalHash: string; filePath: string; size: number }
