import { IFetchComponent } from '@well-known-components/http-server'
import { ILoggerComponent } from '@well-known-components/interfaces'

export type AssetType = 'scene' | 'wearable' | 'emote' | 'texture'

export interface IAssetServerComponent {
  isReady(): Promise<boolean>
  processScene(params: ProcessSceneParams): Promise<ProcessSceneResponse>
  processAssets(params: ProcessAssetsParams): Promise<ProcessAssetsResponse>
  getBatchStatus(batchId: string): Promise<BatchStatus>
  waitForCompletion(batchId: string, timeoutMs?: number): Promise<BatchStatus>
}

export type ProcessSceneParams = {
  sceneHash: string
  contentBaseUrl: string
  outputHash?: string
  packHashes?: string[]
}

export type ProcessSceneResponse = {
  batch_id: string
  output_hash: string
  scene_hash: string
  total_assets: number
  pack_assets: number
}

export type AssetRequest = {
  url: string
  type: AssetType
  hash: string
  base_url: string
  content_mapping?: Record<string, string>
}

export type ProcessAssetsParams = {
  outputHash?: string
  assets: AssetRequest[]
}

export type ProcessAssetsResponse = {
  batch_id: string
  output_hash: string
  jobs: Array<{
    job_id: string
    hash: string
    status: string
  }>
  total: number
}

export type BatchStatus = {
  batch_id: string
  output_hash: string
  status: 'processing' | 'packing' | 'completed' | 'failed'
  progress: number
  zip_path?: string
  error?: string
  jobs: JobStatus[]
}

export type JobStatus = {
  job_id: string
  hash: string
  asset_type: AssetType
  status: 'queued' | 'downloading' | 'processing' | 'completed' | 'failed'
  progress: number
  elapsed_secs: number
  error?: string
}

export type AssetServerConfig = {
  baseUrl: string
}

export function createAssetServerComponent(
  components: { logs: ILoggerComponent; fetch: IFetchComponent },
  config: AssetServerConfig
): IAssetServerComponent {
  const { logs, fetch } = components
  const { baseUrl } = config
  const logger = logs.getLogger('asset-server')

  async function isReady(): Promise<boolean> {
    try {
      const response = await fetch.fetch(`${baseUrl}/health`)
      return response.ok
    } catch {
      return false
    }
  }

  async function processScene(params: ProcessSceneParams): Promise<ProcessSceneResponse> {
    const body = {
      scene_hash: params.sceneHash,
      content_base_url: params.contentBaseUrl,
      output_hash: params.outputHash,
      pack_hashes: params.packHashes
    }

    logger.info('Submitting scene for processing', { sceneHash: params.sceneHash, baseUrl })

    const response = await fetch.fetch(`${baseUrl}/process-scene`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to submit scene for processing: ${response.status} ${errorText}`)
    }

    return (await response.json()) as ProcessSceneResponse
  }

  async function processAssets(params: ProcessAssetsParams): Promise<ProcessAssetsResponse> {
    const body = {
      output_hash: params.outputHash,
      assets: params.assets
    }

    logger.info('Submitting assets for processing', {
      outputHash: params.outputHash || 'auto',
      assetCount: params.assets.length,
      baseUrl
    })

    const response = await fetch.fetch(`${baseUrl}/process`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to submit assets for processing: ${response.status} ${errorText}`)
    }

    return (await response.json()) as ProcessAssetsResponse
  }

  async function getBatchStatus(batchId: string): Promise<BatchStatus> {
    const response = await fetch.fetch(`${baseUrl}/status/${batchId}`)

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to get batch status: ${response.status} ${errorText}`)
    }

    return (await response.json()) as BatchStatus
  }

  async function waitForCompletion(batchId: string, timeoutMs: number = 600000): Promise<BatchStatus> {
    const startTime = Date.now()
    const pollIntervalMs = 2000

    while (Date.now() - startTime < timeoutMs) {
      const status = await getBatchStatus(batchId)

      logger.debug('Batch status', {
        batchId,
        status: status.status,
        progress: status.progress
      })

      if (status.status === 'completed' || status.status === 'failed') {
        return status
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
    }

    throw new Error(`Timeout waiting for batch ${batchId} to complete after ${timeoutMs}ms`)
  }

  return {
    isReady,
    processScene,
    processAssets,
    getBatchStatus,
    waitForCompletion
  }
}
