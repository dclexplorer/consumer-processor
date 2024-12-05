import { CameraMode, engine, Entity, PutComponentOperation, Transform, UiCanvasInformation } from '@dcl/ecs/dist-cjs'
import { ReadWriteByteBuffer } from '@dcl/ecs/dist-cjs/serialization/ByteBuffer'

import type UserIdentity from '~system/UserIdentity'
import type CommsApi from '~system/CommsApi'
import type EnvironmentApi from '~system/EnvironmentApi'
import type EthereumController from '~system/EthereumController'
import type EngineApi from '~system/EngineApi'
import type SignedFetch from '~system/SignedFetch'
import type Runtime from '~system/Runtime'
import type RestrictedActions from '~system/RestrictedActions'
import type CommunicationsController from '~system/CommunicationsController'
import type PortableExperiences from '~system/PortableExperiences'
import type UserActionModule from '~system/UserActionModule'
import type Players from '~system/Players'
import type Scene from '~system/Scene'
import { joinBuffers } from '../../utils'
import { BaseComponents, FetchSceneResponse } from '../../types'
import { createEventHandler, EventListener } from '../../event-handler'

export type LoadableApis = {
  AdaptationLayerHelper: unknown
  EnvironmentApi: typeof EnvironmentApi
  UserIdentity: typeof UserIdentity
  CommsApi: typeof CommsApi
  EthereumController: typeof EthereumController
  EngineApi: typeof EngineApi
  SignedFetch: typeof SignedFetch
  Runtime: typeof Runtime
  RestrictedActions: typeof RestrictedActions
  CommunicationsController: typeof CommunicationsController
  PortableExperiences: typeof PortableExperiences
  UserActionModule: typeof UserActionModule
  Players: typeof Players
  Scene: typeof Scene
}

export type LoadableApisComponent = {
  loadableApis: LoadableApis
  getData(): Uint8Array
  updateDataEventListener: EventListener<Uint8Array>
}

export async function createLoadableApisComponent(
  { fetch }: Pick<BaseComponents, 'fetch'>,
  { contentMapping, mainCrdt }: FetchSceneResponse,
  contentBaseUrl: string
): Promise<LoadableApisComponent> {
  function addPlayerEntityTransform() {
    const buffer = new ReadWriteByteBuffer()
    const transform = Transform.createOrReplace(engine.PlayerEntity)
    Transform.schema.serialize(transform, buffer)
    const transformData = buffer.toCopiedBinary()
    buffer.resetBuffer()
    PutComponentOperation.write(1 as Entity, 1, Transform.componentId, transformData, buffer)
    PutComponentOperation.write(2 as Entity, 1, Transform.componentId, transformData, buffer)
    return buffer.toBinary()
  }

  function addUICanvasOnRootEntity() {
    const buffer = new ReadWriteByteBuffer()
    const uiCanvasInformation = UiCanvasInformation.createOrReplace(engine.RootEntity)
    UiCanvasInformation.schema.serialize(uiCanvasInformation, buffer)
    const uiCanvasComponentData = buffer.toCopiedBinary()
    buffer.resetBuffer()
    PutComponentOperation.write(0 as Entity, 1, UiCanvasInformation.componentId, uiCanvasComponentData, buffer)

    return buffer.toBinary()
  }

  function addCameraMode() {
    const buffer = new ReadWriteByteBuffer()
    const cameraMode = CameraMode.createOrReplace(engine.RootEntity)
    CameraMode.schema.serialize(cameraMode, buffer)
    const cameraModeComponentData = buffer.toCopiedBinary()
    buffer.resetBuffer()
    PutComponentOperation.write(2 as Entity, 1, CameraMode.componentId, cameraModeComponentData, buffer)
    return buffer.toBinary()
  }

  const updateDataEventHandler = createEventHandler<Uint8Array>()
  let savedData: Uint8Array = new Uint8Array(0)

  let currentState: Uint8Array[] = []
  currentState = [addPlayerEntityTransform(), addUICanvasOnRootEntity(), addCameraMode()]
  if (mainCrdt) {
    savedData = joinBuffers(mainCrdt, savedData)
    await updateDataEventHandler.emitEvent(savedData)
    currentState = [...currentState, mainCrdt]
  }

  const loadableApis: LoadableApis = {
    AdaptationLayerHelper: {
      getTextureSize: async () => ({})
    },
    // Emulating old EnvironmentAPI from browser-interface/kernel at https://github.com/decentraland/unity-renderer/blob/dev/browser-interface/packages/shared/apis/host/EnvironmentAPI.ts#L29%60L77
    // to avoid compilation errors on very old sdk6 scenes when running their eval to generate the manifest.
    EnvironmentApi: {
      isPreviewMode: async () => ({ isPreview: false }),
      getBootstrapData: async () => ({
        id: 'string',
        baseUrl: 'string',
        entity: undefined,
        useFPSThrottling: false
      }),
      getPlatform: async () => ({ platform: 'generator' }),
      areUnsafeRequestAllowed: async () => ({ status: false }),
      getCurrentRealm: async () => ({}),
      getExplorerConfiguration: async () => ({
        clientUri: '',
        configurations: {
          questsServerUrl: 'https://quests-api.decentraland.org'
        }
      }),
      getDecentralandTime: async () => ({ seconds: Date.now() / 1000 })
    },
    CommsApi: {
      VideoTrackSourceType: {} as any,
      getActiveVideoStreams: async (_: any) => ({
        streams: []
      })
    },
    EthereumController: {
      requirePayment: async () => ({ jsonAnyResponse: '' }),
      signMessage: async () => ({ message: '', hexEncodedMessage: '', signature: '' }),
      convertMessageToObject: async () => ({ dict: {} }),
      sendAsync: async () => ({ jsonAnyResponse: '' }),
      getUserAccount: async () => ({})
    },
    EngineApi: {
      sendBatch: async () => ({ events: [] }),
      subscribe: async () => ({ events: [] }),
      unsubscribe: async () => ({ events: [] }),
      crdtGetState: async () => ({
        hasEntities: mainCrdt !== undefined,
        data: currentState
      }),
      crdtGetMessageFromRenderer: async () => ({ data: [] }),
      crdtSendToRenderer: async ({ data }: { data: Uint8Array }) => {
        savedData = joinBuffers(savedData, data)
        await updateDataEventHandler.emitEvent(savedData)
        return { data: [] }
      },
      isServer: async () => ({ isServer: true }),
      // Enum types that the compiler thinks we need for the EngineAPI.
      ECS6ComponentAttachToAvatar_AttachToAvatarAnchorPointId: {} as any,
      ECS6ComponentCameraModeArea_CameraMode: {} as any,
      ECS6ComponentNftShape_PictureFrameStyle: {} as any,
      ECS6ComponentUiContainerStack_UIStackOrientation: {} as any,
      ECS6ComponentVideoTexture_VideoStatus: {} as any,
      EventDataType: {} as any,
      UiValue_UiValueType: {} as any
      // End of enum types
    },
    UserIdentity: {
      async getUserData() {
        return {
          data: {
            displayName: 'empty',
            publicKey: 'empty',
            hasConnectedWeb3: true,
            userId: 'empty',
            version: 0,
            avatar: {
              wearables: [''],
              bodyShape: '',
              skinColor: '',
              hairColor: '',
              eyeColor: '',
              snapshots: { face256: '', body: '' }
            }
          }
        }
      },
      getUserPublicKey: async () => ({})
    },
    SignedFetch: {
      signedFetch: async () => ({ ok: false, status: 404, statusText: 'invalid request', headers: {}, body: '' }),
      getHeaders: async () => ({ headers: {} })
    },
    Runtime: {
      getWorldTime: async () => ({ seconds: Date.now() / 1000 }),
      getExplorerInformation: async () => ({
        agent: 'server',
        platform: 'server-platform',
        configurations: {}
      }),
      getRealm: async () => {
        return { realmInfo: undefined }
      },
      // readFile is needed for the adaption-layer bridge to run SDK6 scenes as an SDK7 scene
      readFile: async ({ fileName }: { fileName: string }) => {
        const fileHash: string = contentMapping.find(({ file }: any) => file === fileName).hash
        const res = await fetch.fetch(`${contentBaseUrl}${fileHash}`)
        return {
          content: new Uint8Array(await res.arrayBuffer()),
          hash: fileHash
        }
      },
      getSceneInformation: async () => ({
        urn: 'https://none',
        baseUrl: 'https://none',
        content: [],
        metadataJson: JSON.stringify({
          display: {
            title: '',
            favicon: ''
          },
          owner: '',
          contact: {
            name: '',
            email: ''
          },
          main: 'bin/game.js',
          tags: [],
          scene: {
            parcels: ['-,-'],
            base: '-,-'
          }
        })
      })
    },
    RestrictedActions: {
      triggerEmote: async () => ({}),
      movePlayerTo: async () => ({}),
      changeRealm: async () => ({ success: true }),
      openExternalUrl: async () => ({ success: true }),
      openNftDialog: async () => ({ success: true }),
      setCommunicationsAdapter: async () => ({ success: true }),
      teleportTo: async () => ({}),
      triggerSceneEmote: async () => ({ success: true })
    },
    CommunicationsController: {
      send: async () => ({}),
      sendBinary: async () => {
        return { data: [] }
      }
    },
    PortableExperiences: {
      exit: async () => ({ status: true }),
      getPortableExperiencesLoaded: async () => ({ loaded: [] }),
      kill: async () => ({ status: true }),
      spawn: async () => ({ name: 'casla', parentCid: '', pid: '' })
    },
    UserActionModule: {
      requestTeleport: async () => ({})
    },
    Players: {
      getPlayerData: async () => ({}),
      getConnectedPlayers: async () => ({ players: [] }),
      getPlayersInScene: async () => ({ players: [] })
    },
    Scene: {
      getSceneInfo: async () => ({ cid: '', metadata: '{}', baseUrl: '', contents: [] })
    }
  }

  return {
    loadableApis,
    getData: function () {
      return savedData
    },
    updateDataEventListener: updateDataEventHandler
  }
}
