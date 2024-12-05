import { IConfigComponent, IFetchComponent, ILoggerComponent } from '@well-known-components/interfaces'

export type BaseComponents = {
  logs: ILoggerComponent
  config: IConfigComponent
  fetch: IFetchComponent
  sceneFetcher: ISceneFetcherComponent
}

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
