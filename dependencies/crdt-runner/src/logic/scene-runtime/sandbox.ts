const allowListES2020: Array<keyof typeof globalThis> = [
  'Array',
  'ArrayBuffer',
  'BigInt',
  'BigInt64Array',
  'BigUint64Array',
  'Boolean',
  'DataView',
  'Date',
  'decodeURI',
  'decodeURIComponent',
  'encodeURI',
  'encodeURIComponent',
  'Error',
  'escape',
  'eval',
  'EvalError',
  'Float32Array',
  'Float64Array',
  'Function',
  'globalThis',
  'Infinity',
  'Int16Array',
  'Int32Array',
  'Int8Array',
  'isFinite',
  'isNaN',
  'JSON',
  'Map',
  'Math',
  'NaN',
  'Number',
  'Object',
  'parseFloat',
  'parseInt',
  'Promise',
  'Proxy',
  'RangeError',
  'ReferenceError',
  'Reflect',
  'RegExp',
  'Set',
  'SharedArrayBuffer',
  'String',
  'Symbol',
  'SyntaxError',
  'TypeError',
  'Uint16Array',
  'Uint32Array',
  'Uint8Array',
  'Uint8ClampedArray',
  'undefined',
  'unescape',
  'URIError',
  'WeakMap',
  'WeakSet'
]

// eslint-disable-next-line @typescript-eslint/ban-types
// defer implementation
const defer = (fn: () => void): void => queueMicrotask(fn)

export async function customEvalSdk7(code: string, context: Record<string | symbol, unknown>) {
  const func = new Function('globalThis', `with (globalThis) {${code}}`)
  const proxy = new Proxy(context, {
    has(target, propKey) {
      return propKey in target || allowListES2020.includes(propKey as any) || propKey === 'globalThis'
    },
    get(target, propKey, receiver) {
      if (propKey === 'eval') return eval
      if (propKey === 'globalThis' || propKey === 'global') return receiver
      if (propKey === 'undefined') return undefined
      if (propKey in target) return target[propKey]
      if (allowListES2020.includes(propKey as any)) {
        return Reflect.get(globalThis, propKey)
      }
      return undefined
    }
  })

  return defer(() => {
    try {
      return func.call(proxy, proxy)
    } catch (error) {
      console.error('Evaluation error:', error)
      throw error
    }
  })
}
