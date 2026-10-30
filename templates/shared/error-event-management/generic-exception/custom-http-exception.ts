import { HttpException, HttpStatus } from '@nestjs/common'
import LoggerService from '../logger/logger.service'

export class CustomHttpException extends HttpException {
  #message: any
  #statusCode: HttpStatus
  #stackError: any

  constructor(message: any, statusCode: HttpStatus, stackError?: any) {
    super(message, statusCode, stackError)
    this.#message = message
    this.#statusCode = statusCode
    this.#stackError = stackError

    LoggerService.error(
      JSON.stringify({ AdditionalFailureInformation: this.#stackError })
    )
  }
}
