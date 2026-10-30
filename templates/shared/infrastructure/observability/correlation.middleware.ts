import { randomUUID } from 'node:crypto'
import { NextFunction, Request, Response } from 'express'
import { CORRELATION_HEADER, runWithCorrelationId } from './correlation-context'

// Only safe characters are accepted from the caller: anything else could forge log lines.
const SAFE_CORRELATION_ID = /^[A-Za-z0-9._-]{1,128}$/

/**
 * Caller-independent correlation id: reuses x-correlation-id when the caller
 * sends a valid one (to chain multi-service flows) and GENERATES one otherwise.
 * The id is stored for the whole request (logs, outbound calls, error envelopes)
 * and returned in the response header. Register it right after Cache-Control.
 *
 * Uses node:crypto randomUUID on purpose: the `uuid` package is ESM-only and
 * crashes a CommonJS build at runtime.
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
