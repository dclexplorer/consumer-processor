import { DeploymentToSqs } from '@dcl/schemas/dist/misc/deployments-to-sqs'
import { AppComponents } from '../types'
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns'

export interface ISNSAdapterComponent {
  // publishes a job for the queue
  publish(message: DeploymentToSqs): Promise<void>
}

export function createSnsAdapterComponent(
  components: Pick<AppComponents, 'logs'>,
  options: { snsArn: string; snsEndpoint?: string }
): ISNSAdapterComponent {
  const logger = components.logs.getLogger('sns')

  const client = new SNSClient({
    endpoint: options.snsEndpoint
  })

  return {
    publish: async (message: DeploymentToSqs) => {
      // send sns
      const receipt = await client.send(
        new PublishCommand({
          TopicArn: options.snsArn,
          Message: JSON.stringify(message)
        })
      )
      logger.info('Notification sent', {
        messageId: receipt.MessageId as any,
        sequenceNumber: receipt.SequenceNumber as any
      })
    }
  }
}

export function createMockSnsAdapterComponent(components: Pick<AppComponents, 'logs'>): ISNSAdapterComponent {
  const logger = components.logs.getLogger('sns')
  let sequenceNumber = 0
  return {
    publish: async (_: DeploymentToSqs) => {
      sequenceNumber++
      // send sns
      logger.info('Mock SNS Sent', {
        sequenceNumber
      })
    }
  }
}
