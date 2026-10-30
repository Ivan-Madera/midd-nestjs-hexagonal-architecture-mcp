import { Module } from '@nestjs/common'
import { __Dominio__CoreModule } from './core/__dominioKebab__.core.module'
import { Infrastructure__Dominio__Module } from './infrastructure/__dominioKebab__.infrastructure.module'
// Adapter por defecto: TypeORM. Si usas stored procedure, cambia este import
// y el de __dominioKebab__.infrastructure.module.ts al `.sp.adapter` (en ambos).
import { __Caso__Adapter } from './infrastructure/adapters/__casoKebab__.typeorm.adapter'

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
