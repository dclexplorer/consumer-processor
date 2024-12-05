import { DeploymentToSqs } from '@dcl/schemas/dist/misc/deployments-to-sqs'
import { TaskQueueMessage } from '../../adapters/sqs'
import { AppComponents } from '../../types'
import { runNode } from './run-node'
import { existsSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'

const outputPath = 'output'

export async function generateCrdt(
  message: DeploymentToSqs,
  _msg: TaskQueueMessage,
  components: Pick<AppComponents, 'logs' | 'config' | 'storage' | 'snsAdapter'>
) {
  const { logs, storage, snsAdapter } = components
  const logger = logs.getLogger('crdt-generator')
  const entityId = message.entity.entityId

  if (existsSync(outputPath)) {
    await rm(outputPath, { recursive: true, force: true })
  }
  await mkdir(outputPath, { recursive: true })

  try {
    const contentBaseUrl =
      message.contentServerUrls && message.contentServerUrls.length > 0
        ? message.contentServerUrls[0] + '/contents/'
        : 'https://peer.decentraland.org/content/contents/'

    await runNode(
      components,
      ['--output-path', outputPath, '--content-base-url', contentBaseUrl, '--scene-id', entityId],
      1000
    )

    const outputFilePath = `${outputPath}/${entityId}.crdt`
    await storage.storeFile(`${entityId}.crdt`, outputFilePath)

    if (snsAdapter) {
      await snsAdapter.publish(message)
    }
  } catch (e) {
    logger.error(`Error ${e}`)
  }
}
