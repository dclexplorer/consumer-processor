import { createDotEnvConfigComponent } from '@well-known-components/env-config-provider'
import { createFetchComponent } from '@well-known-components/fetch-component'
import { createSceneFetcherComponent } from './logic/sceneFetcher'
import { BaseComponents } from './types'
import { createLogComponent, metricDeclarations } from '@well-known-components/logger'
import { createMetricsComponent } from '@well-known-components/metrics'

export async function initComponents(): Promise<BaseComponents> {
  const config = await createDotEnvConfigComponent(
    { path: ['.env.default', '.env'] },
    {
      HTTP_SERVER_PORT: '3001',
      HTTP_SERVER_HOST: '0.0.0.0'
    }
  )
  const metrics = await createMetricsComponent(metricDeclarations, { config })
  const logs = await createLogComponent({ metrics })
  const fetch = createFetchComponent()
  const sceneFetcher = await createSceneFetcherComponent({ config, fetch })

  return {
    logs,
    config,
    fetch,
    sceneFetcher
  }
}
