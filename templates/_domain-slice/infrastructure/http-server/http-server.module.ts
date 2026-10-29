import { Module } from '@nestjs/common'
import { __Caso__Controller } from './controllers/__caso__.controller'

@Module({
  controllers: [__Caso__Controller]
})
export class HttpServerModule {}
