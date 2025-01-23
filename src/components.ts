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
import { createMockSnsAdapterComponent, createSnsAdapterComponent } from './adapters/sns'
import { AwsCredentialIdentity } from '@smithy/types'

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
  const prioritySqsQueue = await config.getString('PRIORITY_TASK_QUEUE')
  const taskQueue = sqsQueue
    ? createSqsAdapter<DeploymentToSqs>(
        { logs, metrics },
        { queueUrl: sqsQueue, priorityQueueUrl: prioritySqsQueue, queueRegion: AWS_REGION }
      )
    : createMemoryQueueAdapter<DeploymentToSqs>({ logs, metrics }, { queueName: 'ConversionTaskQueue' })

  const bucket = await config.getString('BUCKET')
  const s3Endpoint = await config.getString('S3_ENDPOINT')
  const prefixVersion = await config.getString('S3_PREFIX')

  const s3AccessKeyId = await config.getString('S3_ACCESS_KEY_ID')
  const s3SecretAccessKey = await config.getString('S3_SECRET_ACCESS_KEY')
  const s3Credentials: AwsCredentialIdentity | undefined =
    s3AccessKeyId && s3SecretAccessKey
      ? {
          accessKeyId: s3AccessKeyId,
          secretAccessKey: s3SecretAccessKey
        }
      : undefined
  const storage =
    bucket !== undefined && bucket !== ''
      ? await createS3StorageComponent(bucket, prefixVersion, s3Endpoint, s3Credentials, { logs })
      : createLocalStorageComponent(path.resolve(process.cwd(), 'storage'), { logs })

  const runner = createRunnerComponent()

  const snsArn = await config.getString('SNS_ARN')
  const snsEndpoint = await config.getString('SNS_ENDPOINT')
  const snsAdapter = snsArn
    ? createSnsAdapterComponent({ logs }, { snsArn, snsEndpoint: snsEndpoint })
    : createMockSnsAdapterComponent({ logs })

  await taskQueue.publish({
    entity: {
      entityId: 'QmZLx1TAYTDSScLYXy4oyAPuXLXMYaA4f5wWKKbA9srgTz',
      authChain: []
    },
    contentServerUrls: ['https://peer.decentraland.org/content']
  })

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
    snsAdapter
  }
}
