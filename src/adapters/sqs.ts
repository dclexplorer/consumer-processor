import { IBaseComponent, IMetricsComponent } from '@well-known-components/interfaces'
import { validateMetricsDeclaration } from '@well-known-components/metrics'
import { AsyncQueue } from '@well-known-components/pushable-channel'
import { SQSClient, SendMessageCommand, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs'
import { AppComponents } from '../types'

export interface TaskQueueMessage {
  id: string
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
    async publish(job) {
      const id = 'job-' + (++lastJobId).toString()
      const message: TaskQueueMessage = { id }
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

export async function createSqsAdapter<T>(
  components: Pick<AppComponents, 'logs' | 'metrics' | 'config'>,
  options: { queueUrl: string; priorityQueueUrl?: string; queueRegion?: string }
): Promise<ITaskQueue<T>> {
  const accessKeyId = await components.config.requireString('AWS_ACCESS_KEY_ID')
  const secretAccessKey = await components.config.requireString('AWS_SECRET_ACCESS_KEY')

  const logger = components.logs.getLogger(options.queueUrl)
  const sqs = new SQSClient({
    region: options.queueRegion,
    credentials: {
      accessKeyId,
      secretAccessKey
    }
  })

  async function receiveMessage(quantityOfMessages: number): Promise<{ response: any | undefined; queueUsed: string }> {
    let response
    let queueUsed = ''

    if (options.priorityQueueUrl) {
      try {
        response = await sqs.send(
          new ReceiveMessageCommand({
            MaxNumberOfMessages: quantityOfMessages,
            MessageAttributeNames: ['All'],
            QueueUrl: options.priorityQueueUrl,
            WaitTimeSeconds: 15,
            VisibilityTimeout: 3 * 3600
          })
        )
        queueUsed = options.priorityQueueUrl
      } catch {}
    }

    if (!response || !response.Messages || response.Messages.length < 1) {
      response = await sqs.send(
        new ReceiveMessageCommand({
          MaxNumberOfMessages: quantityOfMessages,
          MessageAttributeNames: ['All'],
          QueueUrl: options.queueUrl,
          WaitTimeSeconds: 15,
          VisibilityTimeout: 3 * 3600
        })
      )
      queueUsed = options.queueUrl
    }

    return { response, queueUsed }
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

      const m: TaskQueueMessage = { id: published.MessageId! }

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
              const message: TaskQueueMessage = { id: it.MessageId! }
              const { end } = components.metrics.startTimer('job_queue_duration_seconds', {
                queue_name: options.queueUrl
              })
              try {
                logger.info(`Processing job`, { id: message.id })
                const result = await taskRunner(JSON.parse(it.Body!), message)
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
