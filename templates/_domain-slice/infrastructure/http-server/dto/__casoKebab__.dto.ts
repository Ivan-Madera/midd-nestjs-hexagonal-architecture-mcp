import { IsNotEmpty, IsString } from 'class-validator'

// Clase de attributes del request JSON:API. Debe exponer exactamente los campos
// que el caso de uso consume (no pidas campos que luego se ignoran).
export class __Attributes__ {
  @IsString({ message: '__param__ parameter must be of type string.' })
  @IsNotEmpty({ message: '__param__ parameter must not be empty.' })
  __param__: string
}
