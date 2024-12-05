export type ListenerFunction<T> = (data: T) => Promise<void> | void

export type EventEmitter<T> = {
  emitEvent: (data: T) => Promise<void>
}

export type EventListener<T> = {
  addEventListener: (listener: ListenerFunction<T>) => void
}

// Combine Emitter and Listener into a single type
export type EventHandler<T> = EventEmitter<T> & EventListener<T>

export function createEventHandler<T>(): EventHandler<T> {
  const listeners: ListenerFunction<T>[] = [] // Allow multiple listeners

  return {
    addEventListener: (newListener: ListenerFunction<T>) => {
      listeners.push(newListener) // Add the listener to the list
    },
    emitEvent: async (data: T) => {
      for (const listener of listeners) {
        await listener(data) // Await each listener's completion
      }
    }
  }
}
