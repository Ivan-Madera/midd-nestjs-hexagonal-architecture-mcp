import { DynamicModule, Module, Provider } from '@nestjs/common'
import { DataSource } from 'typeorm'
import { getDataSourceToken } from '@nestjs/typeorm'
import { HttpClientService } from './services/http-client.service'
import { DatabaseCommonService } from './services/database-common.service'

/**
 * Tokens de inyección de los servicios de utilería.
 */
export const HTTP_SERVICES_ADAPTER = 'HTTP_SERVICES_ADAPTER'
export const DATABASE_COMMON_PROCESS_SERVICES_ADAPTER =
  'DATABASE_COMMON_PROCESS_SERVICES_ADAPTER'
/**
 * Token of the DatabaseCommonService of ONE connection. A stored procedure adapter must inject the
 * token of ITS connection: the generic token above is only the first one registered.
 */
export const databaseServiceToken = (connection: string): string =>
  `${DATABASE_COMMON_PROCESS_SERVICES_ADAPTER}_${connection.toUpperCase()}`

/**
 * Módulo global de utilería. Provee el cliente HTTP y, por cada conexión que se
 * le pase, un servicio común de BD para ejecutar stored procedures.
 *
 * `register(connections)` recibe los nombres de las conexiones TypeORM del
 * servicio (p.ej. ['SoftCredito', 'MacropayPF']). Para cada una provee un token
 * `DATABASE_COMMON_PROCESS_SERVICES_ADAPTER_<NOMBRE>`; la primera conexión queda
 * además bajo el token genérico `DATABASE_COMMON_PROCESS_SERVICES_ADAPTER`.
 */
@Module({})
export class UtilsModule {
  static register(connections: string[] = []): DynamicModule {
    const httpServiceProvider: Provider = {
      provide: HTTP_SERVICES_ADAPTER,
      useFactory() {
        return new HttpClientService()
      },
      inject: []
    }

    const dbProviders: Provider[] = []
    const dbTokens: string[] = []

    connections.forEach((name, index) => {
      const token = databaseServiceToken(name)
      dbTokens.push(token)
      dbProviders.push({
        provide: token,
        useFactory: (connection: DataSource) =>
          new DatabaseCommonService(connection),
        inject: [getDataSourceToken(`${name}Connection`)]
      })
      // La primera conexión también se expone bajo el token genérico.
      if (index === 0) {
        dbTokens.push(DATABASE_COMMON_PROCESS_SERVICES_ADAPTER)
        dbProviders.push({
          provide: DATABASE_COMMON_PROCESS_SERVICES_ADAPTER,
          useFactory: (connection: DataSource) =>
            new DatabaseCommonService(connection),
          inject: [getDataSourceToken(`${name}Connection`)]
        })
      }
    })

    return {
      module: UtilsModule,
      global: true,
      imports: [],
      providers: [httpServiceProvider, ...dbProviders],
      exports: [HTTP_SERVICES_ADAPTER, ...dbTokens]
    }
  }
}
