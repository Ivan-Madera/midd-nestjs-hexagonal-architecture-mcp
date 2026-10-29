import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import ConfigurationVariables from './config/ConfigurationVariables'
import { validateEnv } from './config/validationEnvironmentsVariable'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [ConfigurationVariables],
      validate: validateEnv
    })
  ]
})
export class GlobalSettingModule {}
