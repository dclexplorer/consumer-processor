import { createDotEnvConfigComponent } from '@well-known-components/env-config-provider'
import { createServerComponent, createStatusCheckComponent } from '@well-known-components/http-server'
import { createLogComponent } from '@well-known-components/logger'
import { createFetchComponent } from './adapters/fetch'
import { createMetricsComponent, instrumentHttpServerWithMetrics } from '@well-known-components/metrics'
import { AppComponents, GlobalContext, ProcessMethod } from './types'
import { metricDeclarations } from './metrics'
import { createMemoryQueueAdapter, createSqsAdapter } from './adapters/sqs'
import { DeploymentToSqs } from '@dcl/schemas/dist/misc/deployments-to-sqs'
import AWS from 'aws-sdk'
import { createRunnerComponent } from './adapters/runner'
import mitt from 'mitt'
import { createS3StorageComponent } from './adapters/storage'
import { createSceneFetcherComponent } from './runners/crdt-runner/logic/sceneFetcher'
import { createSnsAdapterComponent } from './adapters/sns'

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
  if (!bucket) {
    throw new Error('Missing BUCKET')
  }
  const awsEndpoint = await config.getString('AWS_ENDPOINT')
  const storage = await createS3StorageComponent(bucket, awsEndpoint)

  const runner = createRunnerComponent()

  const processMethod: ProcessMethod = ((await config.getString('PROCESS_METHOD')) as ProcessMethod) || 'LOG'

  const sceneFetcher =
    processMethod === 'GENERATE_CRDT_FROM_SCENE' ? await createSceneFetcherComponent({ config, fetch }) : undefined

  const snsArn = await config.getString('SNS_ARN')
  const snsAdapter = snsArn ? createSnsAdapterComponent({ logs }, { snsArn, snsEndpoint: awsEndpoint }) : undefined

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
    storage,
    sceneFetcher,
    snsAdapter
  }
}
