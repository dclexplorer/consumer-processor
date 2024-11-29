import { Lifecycle } from "@well-known-components/interfaces"
import { setupRouter } from "./controllers/routes"
import { AppComponents, GlobalContext, TestComponents } from "./types"
import { godotGenerateSceneImages } from "./runners/godot_generate_scene_images"

// this function wires the business logic (adapters & controllers) with the components (ports)
export async function main(program: Lifecycle.EntryPointParameters<AppComponents | TestComponents>) {
  const { components, startComponents } = program
  const globalContext: GlobalContext = {
    components,
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
  const processMethod = await components.config.getString('PROCESS_METHOD') || 'log'

  components.runner.runTask(async (opt) => {
    while (opt.isRunning) {
      await components.taskQueue.consumeAndProcessJob(async (job, message) => {
        switch (processMethod) {
          case 'godot_minimap':
            await godotGenerateSceneImages(globalContext.components, job, message)
            break
          case 'log':
            logger.info("Consume and Process: ", { job: JSON.stringify(job), message: JSON.stringify(message) })
            break
        }
      })
    }
  })
}
