import { DynamicModule, Module, Provider } from '@nestjs/common'
import { DataSource } from 'typeorm'
import { getDataSourceToken } from '@nestjs/typeorm'
import { HttpClientService } from './services/http-client.service'
import { DatabaseCommonService } from './services/database-common.service'

export const HTTP_SERVICES_ADAPTER = 'HTTP_SERVICES_ADAPTER'
export const DATABASE_COMMON_PROCESS_SERVICES_ADAPTER =
  'DATABASE_COMMON_PROCESS_SERVICES_ADAPTER'
// register() name of the unnamed TypeOrmModule.forRoot of a refactored project; any other name is '<Name>Connection'.
export const DEFAULT_CONNECTION = 'Default'
const dataSourceTokenOf = (name: string) =>
  getDataSourceToken(name === DEFAULT_CONNECTION ? undefined : `${name}Connection`)
// A stored procedure adapter injects the token of ITS connection: the generic one is only the first registered.
export const databaseServiceToken = (connection: string): string =>
  `${DATABASE_COMMON_PROCESS_SERVICES_ADAPTER}_${connection.toUpperCase()}`

/**
 * Global: the HTTP client and, per connection given to register(), a DatabaseCommonService under
 * DATABASE_COMMON_PROCESS_SERVICES_ADAPTER_<NAME> (the first one also under the generic token).
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
        inject: [dataSourceTokenOf(name)]
      })
      if (index === 0) {
        dbTokens.push(DATABASE_COMMON_PROCESS_SERVICES_ADAPTER)
        dbProviders.push({
          provide: DATABASE_COMMON_PROCESS_SERVICES_ADAPTER,
          useFactory: (connection: DataSource) =>
            new DatabaseCommonService(connection),
          inject: [dataSourceTokenOf(name)]
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
