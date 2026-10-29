import { Transform } from 'class-transformer'
import { SourceError } from './error.response.source.dto'
import { HttpStatusType } from '../../../core/types/genericTypes.type'

export class TError {
  code: string

  @Transform(({ value }) => value.toString())
  status: HttpStatusType

  title: string
  detail: string
  suggestedActions: string
}

export class ErrorResponseBase extends TError {
  source?: SourceError
}
