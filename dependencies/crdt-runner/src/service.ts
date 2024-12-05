import { Lifecycle } from '@well-known-components/interfaces'
import { BaseComponents } from './types'
import { createLoadableApisComponent } from './logic/scene-runtime/apis'
import { createSceneComponent } from './adapters/scene'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import { mkdir, writeFile } from 'fs/promises'
import { existsSync } from 'node:fs'

// this function wires the business logic (adapters & controllers) with the components (ports)
export async function main(program: Lifecycle.EntryPointParameters<BaseComponents>) {
  const { components, startComponents } = program

  // start ports: db, listeners, synchronizations, etc
  await startComponents()

  const logger = components.logs.getLogger('crdt-generator')

  // Define the arguments and options
  const argv = yargs(hideBin(process.argv))
    .option('output-path', {
      type: 'string',
      description: 'The output path',
      demandOption: true // Make this argument required
    })
    .option('scene-id', {
      type: 'string',
      description: 'The scene ID',
      demandOption: true // Make this argument required
    })
    .option('content-base-url', {
      type: 'string',
      description: 'The URL of the content server (example https://peer.decentraland.org/content/contents/)',
      default: 'https://peer.decentraland.org/content/contents/',
      demandOption: false // Make this argument required
    })
    .help() // Add help option
    .alias('help', 'h') // Add alias for help
    .parseSync() // Synchronously parse arguments

  // Process arguments
  const { outputPath, sceneId, contentBaseUrl } = argv

  if (!existsSync(outputPath)) {
    await mkdir(outputPath, { recursive: true })
  }

  const sceneFetcher = components.sceneFetcher!
  const fetchSceneResponse = await sceneFetcher.fetchScene(contentBaseUrl, sceneId)
  const { loadableApis, updateDataEventListener } = await createLoadableApisComponent(
    components,
    fetchSceneResponse,
    contentBaseUrl
  )

  // we write each new data, if the scene crashes, we mantain the output
  updateDataEventListener.addEventListener(async (data: Uint8Array) => {
    const outputFilePath = `${outputPath}/${sceneId}.crdt`
    await writeFile(outputFilePath, data)
  })

  const scene = await createSceneComponent(loadableApis)
  const framesProcessed = await scene.start(fetchSceneResponse.sceneCode).catch(console.error)
  logger.log(`Frame done! framesProcessed=${framesProcessed}`)
}
