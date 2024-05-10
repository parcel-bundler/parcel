import * as handlers from './handlers'

const Handlers = Object.freeze({
  0: handlers.ping
})

export const mainWorkerHandler = () => async (_, event, data) => {
  if (!(event in Handlers)) {
    throw new Error(`Use of unmapped native request: ${event}`)
  }
  return Handlers[event](data)
}
