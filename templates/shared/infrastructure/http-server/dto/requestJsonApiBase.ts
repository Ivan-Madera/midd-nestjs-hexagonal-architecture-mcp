import { Type } from 'class-transformer'
import { IsDefined, IsNotEmpty } from 'class-validator'

export class RequestJsonApiBase<T> {
  @Type(() => String)
  @IsNotEmpty({ message: 'type parameter must not be empty.' })
  @IsDefined({ message: 'type parameter is required.' })
  type: string

  /**
   * @summary las validaciones de attributes se sobreescriben en la función de
   * fábrica createRequestDataJsonApi
   */
  attributes: T
}
