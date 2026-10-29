import { Module } from '@nestjs/common'
import { __Dominio__CoreModule } from './core/__dominio__.core.module'
import { Infrastructure__Dominio__Module } from './infrastructure/infrastructure.__dominio__.module'
// Adapter por defecto: TypeORM. Si usas stored procedure, cambia este import
// y el de infrastructure.__dominio__.module.ts al `.sp.adapter` (en ambos).
import { __Caso__Adapter } from './infrastructure/adapters/__caso__.typeorm.adapter'

/**
 * Módulo raíz del bounded context <Dominio>. Ensambla core (register) con los
 * adapters de infrastructure, mapeándolos a las llaves que `register` espera.
 */
@Module({
  imports: [
    Infrastructure__Dominio__Module,
    __Dominio__CoreModule.register({
      modules: [Infrastructure__Dominio__Module],
      adapters: {
        __caso__OutBound: __Caso__Adapter
      }
    })
  ]
})
export class __Dominio__Module {}
