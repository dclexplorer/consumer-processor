import { HandlerContextWithPath } from '../../types'
import * as fs from 'fs'
import * as mime from 'mime-types'

export async function serveFileHandler(
  context: Pick<HandlerContextWithPath<'logs', '/storage'>, 'url' | 'components'>
) {
  const url = new URL(context.url)
  const filename = url.pathname.split('/').pop()
  const logger = context.components.logs.getLogger('serve-file')
  logger.log('Serving file: ' + filename)

  if (!filename) {
    return { status: 400, body: 'Filename is required' }
  }

  const filePath = `./storage/${filename}`
  try {
    logger.log('Reading file: ' + filePath)
    const file = await fs.promises.readFile(filePath)
    const mimeType = mime.lookup(filePath) || 'application/octet-stream'

    return {
      status: 200,
      headers: {
        'Content-Type': mimeType,
        'Cache-Control': 'public, max-age=31536000'
      },
      body: file
    }
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return { status: 404, body: 'File not found' }
    }
    return { status: 500, body: 'Internal server error' }
  }
}
