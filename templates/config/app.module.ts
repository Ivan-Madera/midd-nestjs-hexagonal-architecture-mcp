import { Module } from '@nestjs/common'
import { UtilsModule } from './shared/utils/utils.module'
import { GlobalSettingModule } from './shared/infrastructure/global-setting.module'
import { SecurityModule } from './shared/infrastructure/security/security.module'
import { HealthModule } from './shared/infrastructure/http-server/health.module'
// Import the root module of every domain as you add them with add_use_case.
// The database module of every connection is imported here too (added by scaffold_service / add_use_case).
// import { __Dominio__Module } from './__dominioKebab__/__dominioKebab__.module'

@Module({
  imports: [
    // The list given to UtilsModule.register holds the names of the connections of the service: it provides
    // a DatabaseCommonService (stored procedures) for each one.
    UtilsModule.register([]),
    GlobalSettingModule,
    // Mandatory HTTP security (rate limit guard). Keep it BEFORE any authorization guard.
    SecurityModule,
    // Liveness probe: POST /{context}/api/v1/health (public even when authorization is enabled).
    HealthModule
    // __Dominio__Module
  ]
})
export class AppModule {}
