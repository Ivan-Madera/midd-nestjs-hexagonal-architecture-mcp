import { Module } from '@nestjs/common'
import { __Caso__Controller } from './controllers/__casoKebab__.controller'

@Module({
  controllers: [__Caso__Controller]
})
export class HttpServerModule {}
