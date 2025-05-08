import { Router } from '@well-known-components/http-server'
import { GlobalContext } from '../types'
import { addQueueMemoryHandler } from './handlers/add-queue-memory'
import { pingHandler } from './handlers/ping-handler'
import { serveFileHandler } from './handlers/serve-file'

export async function setupRouter(_globalContext: GlobalContext): Promise<Router<GlobalContext>> {
  const router = new Router<GlobalContext>()

  router.get('/ping', pingHandler)
  router.post('/add-queue', addQueueMemoryHandler)
  router.get('/storage/:path*', serveFileHandler)

  return router
}
