import type { IFetchComponent } from '@well-known-components/http-server'
import type {
  IConfigComponent,
  ILoggerComponent,
  IHttpServerComponent,
  IBaseComponent,
  IMetricsComponent
} from '@well-known-components/interfaces'
import { metricDeclarations } from './metrics'
import { ITaskQueue } from './adapters/sqs'
import { DeploymentToSqs } from '@dcl/schemas/dist/misc/deployments-to-sqs'
import { IRunnerComponent } from './adapters/runner'
import { Emitter } from 'mitt'
import { IStorageComponent } from './adapters/storage'
import { ISceneFetcherComponent } from './runners/crdt-runner/types'
import { ISNSAdapterComponent } from './adapters/sns'

export type GlobalContext = {
  components: BaseComponents
}

// components used in every environment
export type BaseComponents = {
  config: IConfigComponent
  logs: ILoggerComponent
  server: IHttpServerComponent<GlobalContext>
  fetch: IFetchComponent
  metrics: IMetricsComponent<keyof typeof metricDeclarations>
  taskQueue: ITaskQueue<DeploymentToSqs>
  runner: IRunnerComponent
  deploymentsByPointer: Emitter<Record<string /* pointer */, DeploymentToSqs>>
  storage: IStorageComponent
}

// components used in runtime
export type AppComponents = BaseComponents & {
  statusChecks: IBaseComponent
  sceneFetcher?: ISceneFetcherComponent
  snsAdapter?: ISNSAdapterComponent
}

// components used in tests
export type TestComponents = BaseComponents & {
  // A fetch component that only hits the test server
  localFetch: IFetchComponent
}

// this type simplifies the typings of http handlers
export type HandlerContextWithPath<
  ComponentNames extends keyof AppComponents,
  Path extends string = any
> = IHttpServerComponent.PathAwareContext<
  IHttpServerComponent.DefaultContext<{
    components: Pick<AppComponents, ComponentNames>
  }>,
  Path
>

export type Context<Path extends string = any> = IHttpServerComponent.PathAwareContext<GlobalContext, Path>

export type ProcessMethod = 'LOG' | 'GODOT_GENERATE_MAP' | 'GENERATE_CRDT_FROM_SCENE'
