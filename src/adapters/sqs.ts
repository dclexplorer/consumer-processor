import { IBaseComponent, IMetricsComponent } from '@well-known-components/interfaces'
import { validateMetricsDeclaration } from '@well-known-components/metrics'
import { AsyncQueue } from '@well-known-components/pushable-channel'
import { SQSClient, SendMessageCommand, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs'
import { AppComponents } from '../types'

export interface TaskQueueMessage {
  id: string
  isPriority: boolean
}

export interface ITaskQueue<T> {
  publish(job: T, prioritize?: boolean): Promise<TaskQueueMessage>
  consumeAndProcessJob<R>(
    taskRunner: (job: T, message: TaskQueueMessage) => Promise<R>
  ): Promise<{ result: R | undefined }>
}

export const queueMetrics = validateMetricsDeclaration({
  job_queue_duration_seconds: {
    type: IMetricsComponent.HistogramType,
    help: 'Duration of each job in seconds',
    labelNames: ['queue_name'],
    buckets: [1, 10, 100, 200, 300, 400, 500, 600, 700, 1000, 1200, 1600, 1800, 3600]
  },
  job_queue_enqueue_total: {
    type: IMetricsComponent.CounterType,
    help: 'Total amount of enqueued jobs',
    labelNames: ['queue_name']
  },
  job_queue_failures_total: {
    type: IMetricsComponent.CounterType,
    help: 'Total amount of failed tasks',
    labelNames: ['queue_name']
  }
})

type SNSOverSQSMessage = {
  Message: string
}

export function createMemoryQueueAdapter<T>(
  components: Pick<AppComponents, 'logs' | 'metrics'>,
  options: { queueName: string }
): ITaskQueue<T> & IBaseComponent {
  type InternalElement = { message: TaskQueueMessage; job: T }
  const q = new AsyncQueue<InternalElement>((_action) => void 0)
  let lastJobId = 0

  const logger = components.logs.getLogger(options.queueName)

  return {
    async stop() {
      q.close()
    },
    async publish(job, prioritize?: boolean) {
      const id = 'job-' + (++lastJobId).toString()
      const message: TaskQueueMessage = { id, isPriority: !!prioritize }
      q.enqueue({ job, message })
      logger.info(`Publishing job`, { id })
      components.metrics.increment('job_queue_enqueue_total', { queue_name: options.queueName })
      return message
    },
    async consumeAndProcessJob(taskRunner) {
      const it: InternalElement = (await q.next()).value
      if (it) {
        const { end } = components.metrics.startTimer('job_queue_duration_seconds', { queue_name: options.queueName })
        try {
          logger.info(`Processing job`, { id: it.message.id })
          const result = await taskRunner(it.job, it.message)
          logger.info(`Processed job`, { id: it.message.id })
          return { result, message: it.message }
        } catch (err: any) {
          components.metrics.increment('job_queue_failures_total', { queue_name: options.queueName })
          logger.error(err, { id: it.message.id })
          // q.enqueue(it)
        } finally {
          end()
        }
      }
      return { result: undefined }
    }
  }
}

export interface SqsAdapterOptions {
  queueUrl: string
  priorityQueueUrl?: string
  wearableQueueUrl?: string
  emoteQueueUrl?: string
  queueRegion?: string
  endpoint?: string
}

interface QueueInfo {
  url: string
  name: string
}

export function createSqsAdapter<T>(
  components: Pick<AppComponents, 'logs' | 'metrics'>,
  options: SqsAdapterOptions
): ITaskQueue<T> {
  const logger = components.logs.getLogger(options.queueUrl)
  const sqs = new SQSClient({
    region: options.queueRegion,
    ...(options.endpoint && { endpoint: options.endpoint })
  })

  // Build list of queues for round-robin polling
  // Priority queue is always checked first, then round-robin through entity type queues
  const entityQueues: QueueInfo[] = []
  if (options.queueUrl) entityQueues.push({ url: options.queueUrl, name: 'scene' })
  if (options.wearableQueueUrl) entityQueues.push({ url: options.wearableQueueUrl, name: 'wearable' })
  if (options.emoteQueueUrl) entityQueues.push({ url: options.emoteQueueUrl, name: 'emote' })

  let currentQueueIndex = 0

  async function tryReceiveFromQueue(queueUrl: string, waitTimeSeconds: number): Promise<any | undefined> {
    try {
      const response = await sqs.send(
        new ReceiveMessageCommand({
          MaxNumberOfMessages: 1,
          MessageAttributeNames: ['All'],
          QueueUrl: queueUrl,
          WaitTimeSeconds: waitTimeSeconds,
          VisibilityTimeout: 3 * 3600
        })
      )
      return response?.Messages && response.Messages.length > 0 ? response : undefined
    } catch (err) {
      logger.debug(`Failed to receive from queue ${queueUrl}`, {
        error: err instanceof Error ? err.message : 'Unknown'
      })
      return undefined
    }
  }

  async function receiveMessage(quantityOfMessages: number): Promise<{ response: any | undefined; queueUsed: string }> {
    // First, always check the priority queue
    if (options.priorityQueueUrl) {
      const response = await tryReceiveFromQueue(options.priorityQueueUrl, 1)
      if (response) {
        logger.info('Processing from priority queue')
        return { response, queueUsed: options.priorityQueueUrl }
      }
    }

    // Round-robin through entity type queues
    if (entityQueues.length === 0) {
      return { response: undefined, queueUsed: '' }
    }

    // Try each queue starting from current index
    for (let i = 0; i < entityQueues.length; i++) {
      const queueIndex = (currentQueueIndex + i) % entityQueues.length
      const queue = entityQueues[queueIndex]
      const isLastAttempt = i === entityQueues.length - 1

      const response = await tryReceiveFromQueue(queue.url, isLastAttempt ? 15 : 1)
      if (response) {
        logger.info(`Processing from ${queue.name} queue`)
        // Move to next queue for next poll (round-robin)
        currentQueueIndex = (queueIndex + 1) % entityQueues.length
        return { response, queueUsed: queue.url }
      }
    }

    // No messages found in any queue, advance to next queue for fairness
    currentQueueIndex = (currentQueueIndex + 1) % entityQueues.length
    return { response: undefined, queueUsed: '' }
  }

  return {
    async publish(job, prioritize?: boolean) {
      const snsOverSqs: SNSOverSQSMessage = {
        Message: JSON.stringify(job)
      }

      const command = new SendMessageCommand({
        QueueUrl: prioritize && options.priorityQueueUrl ? options.priorityQueueUrl : options.queueUrl,
        MessageBody: JSON.stringify(snsOverSqs)
      })

      const published = await sqs.send(command)

      const m: TaskQueueMessage = { id: published.MessageId!, isPriority: !!prioritize }

      logger.info(`Publishing job ${JSON.stringify(m)}`)

      components.metrics.increment('job_queue_enqueue_total', { queue_name: options.queueUrl })
      return m
    },

    async consumeAndProcessJob(taskRunner) {
      while (true) {
        try {
          const { response, queueUsed } = await receiveMessage(1)

          if (response && response.Messages && response.Messages.length > 0) {
            for (const it of response.Messages) {
              const isPriority = options.priorityQueueUrl ? queueUsed === options.priorityQueueUrl : false
              const message: TaskQueueMessage = { id: it.MessageId!, isPriority }
              const { end } = components.metrics.startTimer('job_queue_duration_seconds', {
                queue_name: options.queueUrl
              })
              try {
                logger.info(`Processing job`, { id: message.id })
                // Parse the SNS over SQS envelope to extract the actual message
                const bodyParsed = JSON.parse(it.Body!)
                const job = JSON.parse(bodyParsed.Message)
                const result = await taskRunner(job, message)
                logger.info(`Processed job`, { id: message.id })

                await sqs.send(
                  new DeleteMessageCommand({
                    QueueUrl: queueUsed,
                    ReceiptHandle: it.ReceiptHandle!
                  })
                )

                return { result, message }
              } catch (err: any) {
                logger.error(err)

                components.metrics.increment('job_queue_failures_total', { queue_name: options.queueUrl })

                return { result: undefined, message }
              } finally {
                end()
              }
            }
          }
          logger.info(`No new messages in queue. Retrying for 15 seconds`)
        } catch (err: any) {
          logger.error(err)
          await sleep(1000)
        }
      }
    }
  }
}

export async function sleep(ms: number) {
  return new Promise<void>((ok) => setTimeout(ok, ms))
}
