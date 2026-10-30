// Adapter de API externa. Consume el servicio externo con el fetch nativo (consumoHttp, sin axios) y
// traduce la respuesta a una entidad de dominio. No usa base de datos.
//
// Hexagonal puro: la URL, el verbo y la ruta son detalles de INFRAESTRUCTURA; el puerto de dominio solo
// recibe `data`. La URL base sale de ConfigurationVariables.externalApis (variable __ENV_VAR_API__).
// TODO: si la API exige credenciales, leelas de ConfigurationVariables (nunca de process.env ni en el codigo)
// y envialas en `headers`.
import { Inject } from '@nestjs/common'
import { ConfigType } from '@nestjs/config'
import { I__Caso__Repository } from '../../core/domain/ports/outbound/I__Caso__Repository'
import { IconsumoHttp } from '../../../<sharedRoot>/utils/interfaces/IconsumoHttp'
import { HTTP_SERVICES_ADAPTER } from '../../../<sharedRoot>/utils/utils.module'
import ConfigurationVariables from '../../../<sharedRoot>/infrastructure/config/ConfigurationVariables'
import { GenericException } from '../../../<sharedRoot>/ErrorEventManagement/genericException/genericException'
import { Mapper } from '../../../<sharedRoot>/utils/services/mapService'
import { __Dominio__DomainError } from '../../core/domain/errors/__dominio__.domain.error'
import { __Request__ } from '../../core/domain/entities/__Request__.entity'
import { __Entidad__ } from '../../core/domain/entities/__Entidad__.entity'

export class __Caso__Adapter implements I__Caso__Repository {
  constructor(
    @Inject(HTTP_SERVICES_ADAPTER)
    private readonly http: IconsumoHttp,
    @Inject(ConfigurationVariables.KEY)
    private readonly config: ConfigType<typeof ConfigurationVariables>
  ) {}

  async __metodo__(data: __Request__): Promise<__Entidad__> {
    const response = await this.http.__HTTP_CALL__
    return this.result(response, __Entidad__)
  }

  // Base URL of the external API joined to a path, without doubling the slash.
  private url(path: string): string {
    return `${this.config.externalApis.__ApiExterna__.baseUrl.replace(/\/+$/, '')}${path}`
  }

  // 404 means nothing was found: null, and the application service decides what that means. Not reaching the
  // API, a timeout or any other error status is an upstream error of the domain catalog. consumoHttp never
  // throws: it resolves to { status, data, ... } and a missing status means the call itself failed.
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
