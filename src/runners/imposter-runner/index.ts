import { DeploymentToSqs } from '@dcl/schemas/dist/misc/deployments-to-sqs'
import { TaskQueueMessage } from '../../adapters/sqs'
import { AppComponents } from '../../types'
import { run } from './run'
import { existsSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { listFilesInFolder } from '../../fs-helper'
import { basename } from 'path'

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
    //const command = ['decentra-bevy.exe', '--impost', '150,300,600,1200,2400,5000', '--scene-id', entityId].join(' ')
    const command = ['echo', '--impost', '150,300,600,1200,2400,5000', '--scene-id', entityId].join(' ')

    const { stdout, stderr, error } = await run(components, command, 60000)
    logger.info('run output:')
    logger.info(stdout)
    logger.info(stderr)
    if (error) {
      throw new Error(`Error executing imposter generator`)
    }

    if (existsSync(outputPath)) {
      const files = await listFilesInFolder(outputPath)
      const keysAndFiles = files.map((f) => {
        return { key: basename(f), filePath: f }
      })
      await storage.storeFiles(keysAndFiles)
    } else {
      throw new Error(`Folder doesn't exists outputPath=${outputPath}`)
    }
  } catch (e) {
    logger.error(`Error ${e}`)
  }
}
