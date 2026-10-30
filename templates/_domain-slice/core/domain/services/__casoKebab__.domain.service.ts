import { __Request__ } from '../entities/__requestKebab__.entity'
import { __Entidad__ } from '../entities/__entidadKebab__.entity'
import { I__Caso__Service } from '../ports/inbound/__casoKebab__.inbound.port'
import { I__Caso__Repository } from '../ports/outbound/__casoKebab__.outbound.port'
import { GenericException } from '../../../../<sharedRoot>/error-event-management/generic-exception/generic-exception'
import { __Dominio__DomainError } from '../errors/__dominioKebab__.domain.error'

export class __Caso__DomainService implements I__Caso__Service {
  constructor(private readonly __caso__Repository: I__Caso__Repository) {}

  async __metodo__(data: __Request__): Promise<__Entidad__> {
    const result = await this.__caso__Repository.__metodo__(data)
    if (!result) {
      throw new GenericException(
        __Dominio__DomainError['__ERROR_KEY__'].message,
        __Dominio__DomainError['__ERROR_KEY__']
      )
    }
    return result
  }
}
