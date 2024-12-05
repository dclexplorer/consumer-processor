import { BaseComponents, FetchSceneResponse, ISceneFetcherComponent } from '../types'

export async function createSceneFetcherComponent({
  fetch
}: Pick<BaseComponents, 'config' | 'fetch'>): Promise<ISceneFetcherComponent> {
  async function fetchSceneCode(contentBaseUrl: string, sceneData: any) {
    const runtimeVersion: string | undefined = sceneData.metadata?.runtimeVersion
    if (runtimeVersion !== '7') {
      // SDK6 scenes support
      // sdk6 scene content will be later read by the adaption-layer internally using the Runtime.readFile API
      const fetchResponse = await fetch.fetch(
        `https://renderer-artifacts.decentraland.org/sdk6-adaption-layer/main/index.js`
      )
      return await fetchResponse.text()
    } else {
      // Get SDK7 scene main file (index.js/game.js)
      const sceneMainFileHash = sceneData.content.find(($: any) => $.file === sceneData.metadata?.main)?.hash
      if (!sceneMainFileHash) {
        throw new Error(`ABORT: Cannot find scene's main asset file.`)
      }
      const sceneCodeResponse = await fetch.fetch(`${contentBaseUrl}${sceneMainFileHash}`)
      return await sceneCodeResponse.text()
    }
  }

  async function fetchScene(contentBaseUrl: string, sceneId: string): Promise<FetchSceneResponse> {
    const sceneDataResponse = await fetch.fetch(`${contentBaseUrl}${sceneId}`, {
      method: 'get',
      headers: { 'content-type': 'application/json' }
    })
    const sceneData = await sceneDataResponse.json()
    const contentMapping = sceneData.content

    const runtimeVersion: string | undefined = sceneData.metadata?.runtimeVersion

    console.log(`Fetched scene data scene id:${sceneId}; sdk7=${runtimeVersion === '7'}`)

    // SDK7 editor-made scenes support (main.crdt binary file)
    const mainCRDTFileName = 'main.crdt'
    let mainCrdt = undefined
    const sceneMainCRDTFileHash = sceneData.content.find(($: any) => $.file === mainCRDTFileName)?.hash
    if (sceneMainCRDTFileHash) {
      const fetchResponse = await fetch.fetch(`${contentBaseUrl}${sceneMainCRDTFileHash}`)
      mainCrdt = new Uint8Array(await fetchResponse.arrayBuffer())
    }

    const sceneCode = await fetchSceneCode(contentBaseUrl, sceneData)

    return {
      sceneId,
      sceneCode,
      contentMapping,
      mainCrdt,
      sdk7: runtimeVersion === '7'
    }
  }

  return {
    fetchScene
  }
}
