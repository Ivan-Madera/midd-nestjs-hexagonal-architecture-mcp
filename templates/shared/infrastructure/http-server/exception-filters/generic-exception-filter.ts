import {
  Catch,
  ExceptionFilter,
  ArgumentsHost,
  HttpStatus,
  NotFoundException,
  BadRequestException
} from '@nestjs/common'
import { HttpArgumentsHost } from '@nestjs/common/interfaces'
import { ErrorResponse } from '../dto/error.response.dto'
import { getCorrelationId } from '../../observability/correlationContext'

// Errors raised by the body parser. It runs BEFORE Nest, so they are not HttpExceptions: the status they
// carry is already right (413 / 400), but without this table the client would read "Internal Server Error"
// and a generic code for what is a client error. A Map, so an odd `type` can never match by accident.
const BODY_PARSER_ERRORS = new Map<string, { status: HttpStatus; code: string; title: string; detail: string; suggestedActions: string }>([
  [
    'entity.too.large',
    {
      status: HttpStatus.PAYLOAD_TOO_LARGE,
      code: 'SERVICE-PAYLOADTOOLARGE-019',
      title: 'Payload Too Large',
      detail: 'The request body exceeds the maximum allowed size.',
      suggestedActions: 'Send a smaller body.'
    }
  ],
  [
    'entity.parse.failed',
    {
      status: HttpStatus.BAD_REQUEST,
      code: 'SERVICE-BADREQUEST-016',
      title: 'Bad Request',
      detail: 'The request body is not valid JSON.',
      suggestedActions: 'Ensure that the data format is correct and follows the API documentation.'
    }
  ]
])

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: any, host: ArgumentsHost) {
    const ctx: HttpArgumentsHost = host.switchToHttp()
    const response: any = ctx.getResponse()
    const request: any = ctx.getRequest()
    const url: string = request?.originalUrl ?? ''
    const meta = { correlationId: getCorrelationId() }

    let errorResponse: ErrorResponse
    let status: HttpStatus =
      exception.status ?? HttpStatus.INTERNAL_SERVER_ERROR
    let title = 'Internal Server Error'
    let details = 'Please check the server logs for more information.'
    let suggestedAction = 'Please try again later.'
    let code = 'PF-ERROR-GENERIC'

    if (exception instanceof NotFoundException) {
      status = exception.getStatus()
      details = 'The requested resource was not found on the server.'
      suggestedAction = `Ensure that the URL '${url}' is correct.`
      title = 'Resource not found'
      code = 'SERVICE-RESOURCENOTFOUND-015'

      errorResponse = new ErrorResponse({
        code,
        status: status.toString(),
        source: { pointer: url },
        suggestedActions: suggestedAction,
        title,
        detail: details
      }, meta)

      return response.status(status).json(errorResponse)
    }

    if (exception instanceof BadRequestException) {
      status = exception.getStatus()
      const messageResponse = exception?.getResponse()['message']
      details = Array.isArray(messageResponse)
        ? messageResponse.shift()
        : messageResponse
      suggestedAction =
        'Ensure that the data format is correct and follows the API documentation.'
      title = 'Bad Request'
      code = 'SERVICE-BADREQUEST-016'

      errorResponse = new ErrorResponse({
        code,
        status: status.toString(),
        source: { pointer: url },
        suggestedActions: suggestedAction,
        title,
        detail: details
      }, meta)

      return response.status(status).json(errorResponse)
    }

    const parserError =
      typeof exception?.type === 'string' ? BODY_PARSER_ERRORS.get(exception.type) : undefined
    if (parserError) {
      errorResponse = new ErrorResponse(
        {
          code: parserError.code,
          status: parserError.status.toString(),
          source: { pointer: url },
          suggestedActions: parserError.suggestedActions,
          title: parserError.title,
          detail: parserError.detail
        },
        meta
      )
      return response.status(parserError.status).json(errorResponse)
    }

    details = exception?.getResponse?.()['details'] ?? details
    suggestedAction =
      exception?.getResponse?.()['suggestedActions'] ?? suggestedAction
    title = exception?.getResponse?.()['title'] ?? title
    code = exception?.getResponse?.()['code'] ?? code

    errorResponse = new ErrorResponse({
      code,
      status: status.toString(),
      source: { pointer: url },
      suggestedActions: suggestedAction,
      title,
      detail: details
    }, meta)

    return response.status(status).json(errorResponse)
  }
}
