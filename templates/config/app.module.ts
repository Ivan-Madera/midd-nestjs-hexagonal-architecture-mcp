import { Module } from '@nestjs/common'
import { UtilsModule } from './shared/utils/utils.module'
import { GlobalSettingModule } from './shared/infrastructure/global-setting.module'
import { SecurityModule } from './shared/infrastructure/security/security.module'
import { HealthModule } from './shared/infrastructure/http-server/health.module'

@Module({
  imports: [
    // One DatabaseCommonService (stored procedures) per connection named here.
    UtilsModule.register([]),
    GlobalSettingModule,
    // Mandatory HTTP security (rate limit guard). Keep it BEFORE any authorization guard.
    SecurityModule,
    HealthModule
  ]
})
export class AppModule {}
