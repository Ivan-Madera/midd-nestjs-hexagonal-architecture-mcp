import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { RateLimitGuard } from './rateLimit.guard'

/**
 * Global HTTP security armor (created ONCE per service, never per domain).
 * Registers the rate limit guard (C1 + C2). If an authorization guard is added
 * later, register it AFTER this module so floods are dropped before authorizing.
 */
@Module({
  providers: [{ provide: APP_GUARD, useClass: RateLimitGuard }]
})
export class SecurityModule {}
