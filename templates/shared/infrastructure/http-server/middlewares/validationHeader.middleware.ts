import {
  HttpException,
  HttpStatus,
  Injectable,
  NestMiddleware
} from '@nestjs/common'
import { Response, Request, NextFunction } from 'express'

@Injectable()
export class ValidationHeaderMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const expectedContentType = 'application/vnd.api+json'
    const contentType: string = req.headers['content-type']
    const httpMethod: string = req.method

    if (contentType !== expectedContentType) {
      const detail = `The Content-Type '${contentType}' header in the request is incorrect.`
      const suggestedAction =
        'Please ensure the Content-Type header is set to the appropriate value as specified in the API documentation.'
      const title = `Incorrect Content-Type '${contentType}' Header`
      const statusCode = HttpStatus.UNSUPPORTED_MEDIA_TYPE
      throw new HttpException(
        {
          status: statusCode,
          title,
          details: detail,
          suggestedActions: suggestedAction,
          code: 'SERVICE-UNSUPPORTED_MEDIA_TYPE-0013'
        },
        statusCode
      )
    }

    if (httpMethod !== 'POST') {
      const detail = `The method ${httpMethod} used for the API request is incorrect.`
      const suggestedAction =
        'Please ensure you are using the appropriate HTTP method specified in the API documentation.'
      const title = 'Invalid API Request Method'
      const statusCode = HttpStatus.NOT_ACCEPTABLE
      throw new HttpException(
        {
          status: statusCode,
          title,
          details: detail,
          suggestedActions: suggestedAction,
          code: 'SERVICE-NOT_ACCEPTABLE-0014'
        },
        statusCode
      )
    }

    next()
  }
}
