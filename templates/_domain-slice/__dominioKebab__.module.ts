import { Module } from '@nestjs/common'
import { __Dominio__CoreModule } from './core/__dominioKebab__.core.module'
import { Infrastructure__Dominio__Module } from './infrastructure/__dominioKebab__.infrastructure.module'
import { __Caso__Adapter } from './infrastructure/adapters/__casoKebab__.typeorm.adapter'

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
