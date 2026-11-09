// TODO(midd): si la API exige credenciales, leelas de ConfigurationVariables y envialas en headers.
import { Inject } from '@nestjs/common'
import { ConfigType } from '@nestjs/config'
import { I__Caso__Repository } from '../../core/domain/ports/outbound/__casoKebab__.outbound.port'
import { IHttpClientService } from '../../../<sharedRoot>/utils/interfaces/http-client.service.interface'
import { HTTP_SERVICES_ADAPTER } from '../../../<sharedRoot>/utils/utils.module'
import ConfigurationVariables from '../../../<sharedRoot>/infrastructure/config/configuration-variables'
import { GenericException } from '../../../<sharedRoot>/error-event-management/generic-exception/generic-exception'
import { Mapper } from '../../../<sharedRoot>/utils/services/map.service'
import { __Dominio__DomainError } from '../../core/domain/errors/__dominioKebab__.domain.error'
import { __Request__ } from '../../core/domain/entities/__requestKebab__.entity'
import { __Entidad__ } from '../../core/domain/entities/__entidadKebab__.entity'

export class __Caso__Adapter implements I__Caso__Repository {
  constructor(
    @Inject(HTTP_SERVICES_ADAPTER)
    private readonly http: IHttpClientService,
    @Inject(ConfigurationVariables.KEY)
    private readonly config: ConfigType<typeof ConfigurationVariables>
  ) {}

  async __metodo__(data: __Request__): Promise<__Entidad__> {
    const response = await this.http.__HTTP_CALL__
    return this.result(response, __Entidad__)
  }

  private url(path: string): string {
    return `${this.config.externalApis.__ApiExterna__.baseUrl.replace(/\/+$/, '')}${path}`
  }

  // 404 = sin resultado (null). Sin respuesta, timeout o cualquier otro status = error de la API externa.
  private result<T>(response: any, target: new () => T): T {
    if (response?.status === 404) return null
    if (!response || response.status === undefined || response.status >= 400) {
      const error = __Dominio__DomainError['EXTERNAL_API_ERROR']
      throw new GenericException(error.message, error)
    }
    if (response.data === null || response.data === undefined) return null
    return Mapper(target, response.data)
  }
}
