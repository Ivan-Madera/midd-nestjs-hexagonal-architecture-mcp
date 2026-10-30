import { DynamicModule, Module } from '@nestjs/common'
import { GenericModuleOptions } from '../../<sharedRoot>/core/types/generic-module-options.type'
import { I__Caso__Repository } from './domain/ports/outbound/__casoKebab__.outbound.port'
import { I__Caso__Service } from './domain/ports/inbound/__casoKebab__.inbound.port'
import { __Caso__DomainService } from './domain/services/__casoKebab__.domain.service'
import { __Caso__ApplicationService } from './application/services/__casoKebab__.application'

/**
 * Tokens de inyección (string) del dominio <Dominio>. Exporta los tokens de
 * aplicación que otros dominios vayan a consumir.
 */
export const __CASO___APPLICATION = '__CASO___APPLICATION'
export const __CASO___SERVICE_PORT_INBOUND = '__CASO___SERVICE_PORT_INBOUND'

@Module({})
export class __Dominio__CoreModule {
  static register({ modules, adapters }: GenericModuleOptions): DynamicModule {
    const { __caso__OutBound } = adapters

    const __caso__ServiceProvider = {
      provide: __CASO___SERVICE_PORT_INBOUND,
      useFactory(repository: I__Caso__Repository) {
        return new __Caso__DomainService(repository)
      },
      inject: [__caso__OutBound]
    }

    const __caso__ApplicationProvider = {
      provide: __CASO___APPLICATION,
      useFactory(service: I__Caso__Service) {
        return new __Caso__ApplicationService(service)
      },
      // Si el caso necesita config (branching), añade ConfigurationVariables.KEY
      // aquí y al constructor: useFactory(service, config) {...} inject: [..., ConfigurationVariables.KEY]
      inject: [__CASO___SERVICE_PORT_INBOUND]
    }

    return {
      module: __Dominio__CoreModule,
      global: true,
      imports: [...modules],
      providers: [__caso__ServiceProvider, __caso__ApplicationProvider],
      exports: [__CASO___APPLICATION]
    }
  }
}
