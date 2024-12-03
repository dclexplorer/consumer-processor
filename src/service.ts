import { IConfigComponent, Lifecycle } from '@well-known-components/interfaces'
import { setupRouter } from './controllers/routes'
import { godotOptimizer } from './runners/godot-optimizer'
import { godotGenerateSceneImages } from './runners/godot-generate-scene-images'
import { AppComponents, GlobalContext, TestComponents } from './types'

const validProcessMethods = ['godot_minimap', 'godot_optimizer', 'log'] as const
type ProcessMethod = (typeof validProcessMethods)[number]

async function getProcessMethod(config: IConfigComponent): Promise<ProcessMethod> {
  const processMethod = (await config.getString('PROCESS_METHOD')) || 'log'
  if (!validProcessMethods.includes(processMethod as any)) {
    throw new Error(`Unknown process method: ${processMethod}`)
  }
  return processMethod as ProcessMethod
}

// this function wires the business logic (adapters & controllers) with the components (ports)
export async function main(program: Lifecycle.EntryPointParameters<AppComponents | TestComponents>) {
  const { components, startComponents } = program
  const globalContext: GlobalContext = {
    components
  }

  // wire the HTTP router (make it automatic? TBD)
  const router = await setupRouter(globalContext)
  // register routes middleware
  components.server.use(router.middleware())
  // register not implemented/method not allowed/cors responses middleware
  components.server.use(router.allowedMethods())
  // set the context to be passed to the handlers
  components.server.setContext(globalContext)

  // start ports: db, listeners, synchronizations, etc
  await startComponents()

  const logger = components.logs.getLogger('main-loop')
  const processMethod = await getProcessMethod(components.config)
  logger.info('Process method: ', { processMethod })

  components.runner.runTask(async (opt) => {
    while (opt.isRunning) {
      await components.taskQueue.consumeAndProcessJob(async (job, message) => {
        try {
          switch (processMethod) {
            case 'godot_optimizer':
              await godotOptimizer(job, message, globalContext.components)
              break
            case 'godot_minimap':
              await godotGenerateSceneImages(globalContext.components, job, message)
              break
            case 'log':
              logger.info('Consume and Process: ', { job: JSON.stringify(job), message: JSON.stringify(message) })
              break
          }
        } catch (error) {
          logger.error(`Error processing job ${job.entity.entityId}`)
          logger.error(error as any)
        }
      })
    }
  })
}
