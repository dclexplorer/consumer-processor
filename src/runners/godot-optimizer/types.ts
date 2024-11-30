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
  hash: string
}

export type GltfWithDependencies = DownloadedFile & {
  gltf: GltfJsonData
  dependencies: GltfDependency[]
}
