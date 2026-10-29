import { Inject, Injectable } from '@nestjs/common'
import { TypeOrmModuleOptions, TypeOrmOptionsFactory } from '@nestjs/typeorm'
import { ConfigType } from '@nestjs/config'
import ConfigurationVariables from '../../config/ConfigurationVariables'

/**
 * TypeORM options (__typeormType__) of the named connection '<Conexion>Connection'.
 * The values come from ConfigurationVariables.database.<Conexion>, which reads the
 * environment variables <envPrefix>_HOST, _PORT, _USERNAME, _PASSWORD and _NAME.
 */
@Injectable()
export class __Conexion____Motor__Option implements TypeOrmOptionsFactory {
  constructor(
    @Inject(ConfigurationVariables.KEY)
    protected configService?: ConfigType<typeof ConfigurationVariables>
  ) {}

  createTypeOrmOptions(): TypeOrmModuleOptions | Promise<TypeOrmModuleOptions> {
    const db = this.configService.database.<Conexion>
    return {
      type: '__typeormType__',
      host: db.Server,
      port: db.Port,
      username: db.UserName,
      password: db.Password,
      database: db.DataBaseName,
      // Entities registered with TypeOrmModule.forFeature(...) are added to this connection
      // automatically: there is no list of entities to maintain by hand.
      autoLoadEntities: true,
      synchronize: false,__extraOptions__
      logging: ['query']
      // pool/timeouts: the defaults of TypeORM and of the driver are used.
    }
  }
}
