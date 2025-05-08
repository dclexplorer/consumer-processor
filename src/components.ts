import { DeploymentToSqs } from '@dcl/schemas/dist/misc/deployments-to-sqs'
import { createDotEnvConfigComponent } from '@well-known-components/env-config-provider'
import { createServerComponent, createStatusCheckComponent } from '@well-known-components/http-server'
import { createLogComponent } from '@well-known-components/logger'
import { createMetricsComponent, instrumentHttpServerWithMetrics } from '@well-known-components/metrics'
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

// Helper function to handle entityId logic
async function handleEntityId(
  entityId: string,
  fetch: AppComponents['fetch'],
  logs: AppComponents['logs'],
  taskQueue: AppComponents['taskQueue']
) {
  if (entityId.includes(',')) {
    try {
      const response = await fetch.fetch('https://peer.decentraland.org/content/entities/active', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ pointers: [entityId] })
      })

      if (!response.ok) {
        throw new Error(`Failed to fetch entity ID: ${response.statusText}`)
      }

      const data = await response.json()
      const ids = data.map((entity: { id: string }) => entity.id)

      if (ids.length > 0) {
        entityId = ids[0] // Use the first ID as the entityId
        logs.getLogger('main').log(`Resolved Entity ID from pointer: ${entityId}`)
        await taskQueue.publish({
          entity: {
            entityId,
            authChain: []
          },
          contentServerUrls: ['https://peer.decentraland.org/content']
        })
      } else {
        logs.getLogger('main').error('Error: No entity ID found for the given pointer')
      }
    } catch (error) {
      logs.getLogger('main').error(`Error resolving entity ID from pointer: ${error}`)
    }
  } else if (entityId.endsWith('.dcl.eth')) {
    try {
      const response = await fetch.fetch(`https://worlds-content-server.decentraland.org/world/${entityId}/about`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      })

      if (!response.ok) {
        throw new Error(`Failed to fetch world data: ${response.statusText}`)
      }

      const data = await response.json()
      const urn = data.configurations?.scenesUrn?.[0]
      if (urn) {
        const urnParts = urn.split(':')
        entityId = urnParts[3].split('?')[0] // Extract the entityId
        let baseUrl = urn.split('baseUrl=')[1] // Extract the baseUrl
        baseUrl = baseUrl.replace(/\/contents\/?$/, '') // Remove trailing /contents or /contents/
        logs.getLogger('main').log(`Resolved Entity ID: ${entityId}, Base URL: ${baseUrl}`)

        // Publish the resolved entityId and baseUrl
        await taskQueue.publish({
          entity: {
            entityId: entityId,
            authChain: []
          },
          contentServerUrls: [baseUrl]
        })
      } else {
        logs.getLogger('main').error('Error: No URN found in world data')
      }
    } catch (error) {
      logs.getLogger('main').error(`Error resolving entity ID from .dcl.eth domain: ${error}`)
    }
  } else {
    // Publish the resolved or provided entityId
    logs.getLogger('main').log(`Scheduled Entity ID: ${entityId}`)
    await taskQueue.publish({
      entity: {
        entityId: entityId,
        authChain: []
      },
      contentServerUrls: ['https://peer.decentraland.org/content']
    })
  }
}

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

  const sqsQueue = await config.getString('TASK_QUEUE')
  const prioritySqsQueue = await config.getString('PRIORITY_TASK_QUEUE')
  const taskQueue = sqsQueue
    ? createSqsAdapter<DeploymentToSqs>({ logs, metrics }, { queueUrl: sqsQueue, priorityQueueUrl: prioritySqsQueue })
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

  const entityIdIndex = process.argv.findIndex((p) => p === '--entityId')
  if (entityIdIndex !== -1) {
    const entityId = process.argv[entityIdIndex + 1]
    if (entityId) {
      await handleEntityId(entityId, fetch, logs, taskQueue)
    } else {
      logs.getLogger('main').error('Error: Please provide a value for --entityId')
    }
  }

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
