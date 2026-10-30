import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import ConfigurationVariables from './config/configuration-variables'
import { validateEnv } from './config/validation-environments-variable'

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
