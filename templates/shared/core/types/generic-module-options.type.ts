import { Type } from '@nestjs/common'

export type GenericModuleOptions = {
  modules: Type[]
  adapters?: {
    [key: string]: Type<any>
  }
}
