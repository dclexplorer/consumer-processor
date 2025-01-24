import { DeploymentToSqs } from '@dcl/schemas/dist/misc/deployments-to-sqs'
import { TaskQueueMessage } from '../../adapters/sqs'
import { AppComponents } from '../../types'
import { run } from './run'
import { existsSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'

const outputPath = 'output'

export async function generateImposter(
  components: Pick<AppComponents, 'logs' | 'config' | 'storage'>,
  data: DeploymentToSqs,
  _msg: TaskQueueMessage
) {
  const { logs, storage } = components
  const logger = logs.getLogger('imposter-runner')
  const entityId = data.entity.entityId

  if (existsSync(outputPath)) {
    await rm(outputPath, { recursive: true, force: true })
  }
  await mkdir(outputPath, { recursive: true })

  try {
    const command = ['decentra-bevy.exe', '--impost', '150,300,600,1200,2400,5000'].join(' ')

    const { stdout, stderr, error } = await run(components, command, 60000)
    logger.info('run output:')
    logger.info(stdout)
    logger.info(stderr)
    if (error) {
      throw new Error(`Error executing imposter generator`)
    }

    const outputFilePath = `${outputPath}/${entityId}`
    if (existsSync(outputFilePath)) {
      await storage.storeFile(`${entityId}`, outputFilePath)
    } else {
      throw new Error(`File doesn't exists outputFilePath=${outputFilePath}`)
    }
  } catch (e) {
    logger.error(`Error ${e}`)
  }
}
