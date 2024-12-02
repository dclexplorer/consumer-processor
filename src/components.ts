import { DeploymentToSqs } from '@dcl/schemas/dist/misc/deployments-to-sqs'
import { createDotEnvConfigComponent } from '@well-known-components/env-config-provider'
import { createServerComponent, createStatusCheckComponent } from '@well-known-components/http-server'
import { createLogComponent } from '@well-known-components/logger'
import { createMetricsComponent, instrumentHttpServerWithMetrics } from '@well-known-components/metrics'
import AWS from 'aws-sdk'
import mitt from 'mitt'
import { createFetchComponent } from './adapters/fetch'
import { createRunnerComponent } from './adapters/runner'
import { createMemoryQueueAdapter, createSqsAdapter } from './adapters/sqs'
import { createLocalStorageComponent, createS3StorageComponent } from './adapters/storage'
import { metricDeclarations } from './metrics'
import { AppComponents, GlobalContext } from './types'
import path from 'path'

// Initialize all the components of the app
export async function initComponents(): Promise<AppComponents> {
  const config = await createDotEnvConfigComponent({ path: ['.env.default', '.env'] })
  const metrics = await createMetricsComponent(metricDeclarations, { config })
  const logs = await createLogComponent({ metrics })
  const server = await createServerComponent<GlobalContext>(
    { config, logs },
    {
      cors: {}
    }
  )
  const statusChecks = await createStatusCheckComponent({ server, config })
  const fetch = await createFetchComponent()

  await instrumentHttpServerWithMetrics({ metrics, server, config })

  const AWS_REGION = await config.getString('AWS_REGION')
  if (AWS_REGION) {
    AWS.config.update({ region: AWS_REGION })
  }

  const sqsQueue = await config.getString('TASK_QUEUE')
  const taskQueue = sqsQueue
    ? createSqsAdapter<DeploymentToSqs>({ logs, metrics }, { queueUrl: sqsQueue, queueRegion: AWS_REGION })
    : createMemoryQueueAdapter<DeploymentToSqs>({ logs, metrics }, { queueName: 'ConversionTaskQueue' })

  const bucket = await config.getString('BUCKET')
  const awsEndpoint = await config.getString('AWS_ENDPOINT')
  const storage =
    bucket !== undefined && bucket !== ''
      ? await createS3StorageComponent(bucket, awsEndpoint, { logs })
      : createLocalStorageComponent(path.resolve(process.cwd(), 'storage'), { logs })

  const runner = createRunnerComponent()

  return {
    config,
    logs,
    server,
    statusChecks,
    fetch,
    metrics,
    taskQueue,
    runner,
    deploymentsByPointer: mitt(),
    storage
  }
}
