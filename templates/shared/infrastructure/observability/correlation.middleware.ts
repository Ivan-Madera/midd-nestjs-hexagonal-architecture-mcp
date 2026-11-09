import { randomUUID } from 'node:crypto'
import { NextFunction, Request, Response } from 'express'
import { CORRELATION_HEADER, runWithCorrelationId } from './correlation-context'

// Only safe characters are accepted from the caller: anything else could forge log lines.
const SAFE_CORRELATION_ID = /^[A-Za-z0-9._-]{1,128}$/

/**
 * Reuses a valid x-correlation-id or generates one (node:crypto: `uuid` is ESM-only and breaks a CommonJS build).
 */
export function correlationMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const incoming = req.headers[CORRELATION_HEADER]
  const candidate = (Array.isArray(incoming) ? incoming[0] : incoming)?.trim()
  const correlationId =
    candidate && SAFE_CORRELATION_ID.test(candidate) ? candidate : randomUUID()

  res.setHeader(CORRELATION_HEADER, correlationId)
  runWithCorrelationId(correlationId, () => next())
}
