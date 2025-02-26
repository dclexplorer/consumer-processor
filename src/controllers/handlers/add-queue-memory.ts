import { HandlerContextWithPath } from '../../types'

// handlers arguments only type what they need, to make unit testing easier
export async function addQueueMemoryHandler(context: HandlerContextWithPath<'taskQueue' | 'logs', '/add-queue'>) {
  const { url, components } = context

  components.logs.getLogger('add-queue').info('Add to the queue')

  await components.taskQueue.publish({
    entity: {
      entityId: 'bafkreihhe773idda4ww6o6xk7xl46hfkz7ayy2t5bb3ie6imwbqrb54r4q',
      authChain: []
    },
    contentServerUrls: ['https://peer.decentraland.org/content']
  })

  return {
    body: url.pathname
  }
}
