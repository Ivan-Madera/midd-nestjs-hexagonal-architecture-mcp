import {
  IsNotEmpty,
  IsNotEmptyObject,
  IsObject,
  ValidateNested
} from 'class-validator'
import { Type } from 'class-transformer'
import {
  createRequestDataJsonApi,
  RequestDataJsonApiType
} from '../../../../<sharedRoot>/infrastructure/http-server/dto/create-request-data-json-api.dto'
import { __Attributes__ } from './__casoKebab__.dto'

export class __Caso__RequestJsonApiDTO {
  @IsNotEmpty({ message: 'data parameter is required.' })
  @IsNotEmptyObject()
  @IsObject()
  @ValidateNested()
  @Type(() => createRequestDataJsonApi(__Attributes__))
  data: RequestDataJsonApiType<__Attributes__>
}
