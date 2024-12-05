/*import { writeFile } from 'fs/promises'
import { AppComponents } from '../../types'
import { TaskQueueMessage } from '../../adapters/sqs'
import { DeploymentToSqs } from '@dcl/schemas/dist/misc/deployments-to-sqs'
import { existsSync } from 'fs'
import { mkdir, rm } from 'fs/promises'
import { createSceneComponent } from './adapters/scene'
import { createLoadableApisComponent } from './logic/scene-runtime/apis'

const outputPath = 'output'

export async function generateCrdtFromScene(
  components: Pick<AppComponents, 'logs' | 'storage' | 'sceneFetcher' | 'fetch' | 'config' | 'snsAdapter'>,
  job: DeploymentToSqs,
  {}: TaskQueueMessage
) {
  if (existsSync(outputPath)) {
    await rm(outputPath, { recursive: true, force: true })
  }
  await mkdir(outputPath, { recursive: true })

  const { logs, storage } = components
  const logger = logs.getLogger('crdt-generator')
  const entityId = job.entity.entityId

  logger.info('Job:', { data: JSON.stringify(job) })
  try {
    const contentBaseUrl =
      job.contentServerUrls && job.contentServerUrls.length > 0
        ? job.contentServerUrls[0] + '/contents/'
        : 'https://peer.decentraland.org/content/contents/'

    console.log(`contentBaseUrl: ${contentBaseUrl}`)
    const sceneFetcher = components.sceneFetcher!
    const fetchSceneResponse = await sceneFetcher.fetchScene(contentBaseUrl, entityId)
    const { loadableApis, getData } = createLoadableApisComponent(components, fetchSceneResponse, contentBaseUrl)
    const scene = await createSceneComponent(loadableApis)
    const framesProcessed = await scene.start(fetchSceneResponse.sceneCode).catch(console.error)
    logger.log(`Frame done! framesProcessed=${framesProcessed}`)

    const crdtData = getData()
    const outputFilePath = `${outputPath}/${entityId}.crdt`
    await writeFile(outputFilePath, crdtData)

    await storage.storeFile(`${entityId}.crdt`, outputFilePath)
    logger.log(`Upload done!`)

    const snsAdapter = components.snsAdapter
    if (snsAdapter) {
      await snsAdapter.publish(job)
    }
  } catch (e) {
    logger.error(`Error ${e}`)
  }
}
*/
