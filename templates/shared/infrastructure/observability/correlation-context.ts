import { AsyncLocalStorage } from 'node:async_hooks'

export const CORRELATION_HEADER = 'x-correlation-id'

type CorrelationStore = { correlationId: string }

const storage = new AsyncLocalStorage<CorrelationStore>()

export const runWithCorrelationId = <T>(correlationId: string, callback: () => T): T =>
  storage.run({ correlationId }, callback)

/** Correlation id of the current request, or undefined outside a request. */
export const getCorrelationId = (): string | undefined =>
  storage.getStore()?.correlationId
