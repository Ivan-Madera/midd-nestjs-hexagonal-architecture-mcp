import { Type } from 'class-transformer'
import {
  IsDefined,
  IsNotEmptyObject,
  IsObject,
  ValidateNested
} from 'class-validator'
import { RequestJsonApiBase } from './requestJsonApiBase'

/**
 * Función de fábrica para crear la clase concreta de request JSON:API.
 * @param attributesClass clase que valida el objeto `attributes` del request
 */
export const createRequestDataJsonApi = <T>(attributesClass: new () => T) => {
  class RequestDataJsonApi extends RequestJsonApiBase<T> {
    @IsDefined({ message: 'attributes parameter is required.' })
    @IsNotEmptyObject()
    @IsObject()
    @ValidateNested()
    @Type(() => attributesClass)
    attributes: T
  }
  return RequestDataJsonApi
}

/**
 * Alias de tipo genérico para el request JSON:API.
 */
export type RequestDataJsonApiType<T> = InstanceType<
  ReturnType<typeof createRequestDataJsonApi<T>>
>
