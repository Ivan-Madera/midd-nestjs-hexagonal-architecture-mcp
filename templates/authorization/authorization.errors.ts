import { HttpException, HttpStatus } from '@nestjs/common'

type AuthorizationError = {
  code: string
  title: string
  details: string
  status: HttpStatus
  suggestedActions: string
}

// Never expose why the authorizer denied: only that access is not granted.
export const AUTH_ERRORS: Record<'MISSING_TOKEN' | 'FORBIDDEN', AuthorizationError> = {
  MISSING_TOKEN: {
    code: 'SERVICE-UNAUTHORIZED-0020',
    title: 'Missing authorization token',
    details: 'The request does not carry a Bearer token.',
    status: HttpStatus.UNAUTHORIZED,
    suggestedActions: 'Send the Authorization header with a valid Bearer token.'
  },
  FORBIDDEN: {
    code: 'SERVICE-FORBIDDEN-0021',
    title: 'Access denied',
    details: 'The request is not authorized to access this resource.',
    status: HttpStatus.FORBIDDEN,
    suggestedActions: 'Verify that the token is valid and has access to this resource.'
  }
}

// Rendered by the global AllExceptionsFilter into the JSON:API error envelope.
export const authorizationException = (error: AuthorizationError): HttpException =>
  new HttpException({ ...error }, error.status)
