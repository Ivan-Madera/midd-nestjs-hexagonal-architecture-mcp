import { HttpStatus } from '@nestjs/common'
import { NextFunction, Request, Response } from 'express'
import { getCorrelationId } from '../observability/correlationContext'
import { ErrorResponse } from '../http-server/dto/error.response.dto'

export type PayloadLimits = {
  maxBytes: number
  maxJsonBytes: number
}

const isJson = (contentType: string | undefined): boolean =>
  /json/i.test(contentType ?? '')

/**
 * Control C3: rejects oversized bodies BEFORE they are parsed (it only reads the
 * Content-Length header, nothing is buffered). Any `*json*` media type, including
 * application/vnd.api+json, gets the stricter JSON limit. Register it before the
 * body parser; keep the body parser `limit` as a second line of defense.
 */
export function createPayloadSizeMiddleware(limits: PayloadLimits) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const declaredLength = Number(req.headers['content-length'])
    const limit = isJson(req.headers['content-type'])
      ? limits.maxJsonBytes
      : limits.maxBytes

    if (!Number.isFinite(declaredLength) || declaredLength <= limit) {
      next()
      return
    }

    const status = HttpStatus.PAYLOAD_TOO_LARGE
    res.status(status).json(
      new ErrorResponse(
        {
          code: 'SERVICE-PAYLOADTOOLARGE-019',
          status,
          source: { pointer: req.originalUrl },
          suggestedActions: `Send a body smaller than ${limit} bytes.`,
          title: 'Payload Too Large',
          detail: 'The request body exceeds the maximum allowed size.'
        },
        { correlationId: getCorrelationId() }
      )
    )
  }
}
