export class GenericException extends Error {
  message: string
  dataEvent: any
  errorResponse: any

  constructor(message: string, errorResponse: any) {
    super(message)
    this.message = message
    this.errorResponse = errorResponse
  }
}
