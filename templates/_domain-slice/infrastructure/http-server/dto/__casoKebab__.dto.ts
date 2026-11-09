import { IsNotEmpty, IsString } from 'class-validator'

export class __Attributes__ {
  @IsString({ message: '__param__ parameter must be of type string.' })
  @IsNotEmpty({ message: '__param__ parameter must not be empty.' })
  __param__: string
}
