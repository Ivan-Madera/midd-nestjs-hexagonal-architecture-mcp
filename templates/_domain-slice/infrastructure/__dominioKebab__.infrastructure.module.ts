import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { HttpServerModule } from './http-server/http-server.module'
import { __Caso__Adapter } from './adapters/__casoKebab__.typeorm.adapter'
import { __Entidad__EntityConfiguration } from './sql-database/entities/__entidadKebab__.entity'

@Module({
  imports: [
    HttpServerModule,
    TypeOrmModule.forFeature([__Entidad__EntityConfiguration]<ConexionArg>)
  ],
  providers: [__Caso__Adapter],
  exports: [__Caso__Adapter]
})
export class Infrastructure__Dominio__Module {}
