export type FetchSceneResponse = {
  sceneCode: string
  sceneId: string
  contentMapping: any
  sdk7: boolean
  mainCrdt?: Uint8Array
}

export type ISceneFetcherComponent = {
  fetchScene(contentBaseUrl: string, sceneId: string): Promise<FetchSceneResponse>
}
