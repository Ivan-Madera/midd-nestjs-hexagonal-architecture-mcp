import { ErrorResponseBase } from './error.dto'

export type ErrorResponseMeta = {
  correlationId?: string
}

export class ErrorResponse {
  errors: ErrorResponseBase[]
  meta?: ErrorResponseMeta
  constructor(error: ErrorResponseBase, meta?: ErrorResponseMeta) {
    error.status = error.status.toString()
    this.errors = [error]
    if (meta?.correlationId) this.meta = meta
  }
}
