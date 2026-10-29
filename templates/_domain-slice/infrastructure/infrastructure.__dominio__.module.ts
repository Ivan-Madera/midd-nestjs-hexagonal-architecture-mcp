import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { HttpServerModule } from './http-server/http-server.module'
// Elige el adapter según el acceso a datos: TypeORM o SP (borra el que no uses).
import { __Caso__Adapter } from './adapters/__caso__.typeorm.adapter'
import { __Entidad__EntityConfiguration } from './sql-database/entities/__Entidad__.entity'

// Expón los adapters para que el core.module los reciba en `adapters`.
// forFeature registra el repositorio de la entidad en su conexión. Si el adapter
// es de stored procedure (no usa @InjectRepository), puedes omitir el forFeature.
@Module({
  imports: [
    HttpServerModule,
    TypeOrmModule.forFeature([__Entidad__EntityConfiguration]<ConexionArg>)
  ],
  providers: [__Caso__Adapter],
  exports: [__Caso__Adapter]
})
export class Infrastructure__Dominio__Module {}
