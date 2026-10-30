import Logger from '../../../../<sharedRoot>/error-event-management/logger/logger.service'
import { I__Caso__Application } from '../interfaces/__casoKebab__.application.interface'
import { GenericException } from '../../../../<sharedRoot>/error-event-management/generic-exception/generic-exception'
import { __Dominio__ApplicationError } from '../errors/__dominioKebab__.application.error'
import { I__Caso__Service } from '../../domain/ports/inbound/__casoKebab__.inbound.port'
import { __Request__ } from '../../domain/entities/__requestKebab__.entity'
import { __Entidad__ } from '../../domain/entities/__entidadKebab__.entity'

// Importa SIEMPRE las dependencias como interfaces (puertos/ifaces), nunca
// clases concretas. Si el caso necesita config (p.ej. branching por un valor de
// negocio), inyecta @Inject(ConfigurationVariables.KEY) en el constructor y
// añade ConfigurationVariables.KEY al inject del factory del core.module.
export class __Caso__ApplicationService implements I__Caso__Application {
  constructor(private readonly __caso__Service: I__Caso__Service) {}

  async __casoDeUso__(attributes: __Request__): Promise<__Entidad__> {
    Logger.info('------ Inicia __casoDeUso__ ------')
    const result = await this.__caso__Service.__metodo__(attributes)
    if (!result) {
      throw new GenericException(
        __Dominio__ApplicationError['__ERROR_KEY__'].title,
        __Dominio__ApplicationError['__ERROR_KEY__']
      )
    }
    return result
  }
}
