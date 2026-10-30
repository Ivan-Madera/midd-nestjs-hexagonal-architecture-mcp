import { Global, Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { AuthorizationGuard } from './authorization.guard'
import { AUTHORIZATION_VERIFIER } from './authorization.tokens'
import { MacropayApiAuthorizationVerifier } from './infrastructure/macropay-api-authorization-verifier'

/**
 * Composition root of authorization: the ONLY place naming the concrete verifier.
 * To swap the authorizer, change the single useClass line.
 * Import it ONCE in AppModule, AFTER SecurityModule, so the rate limit guard runs first.
 */
@Global()
@Module({
  providers: [
    { provide: AUTHORIZATION_VERIFIER, useClass: MacropayApiAuthorizationVerifier },
    { provide: APP_GUARD, useClass: AuthorizationGuard }
  ],
  exports: [AUTHORIZATION_VERIFIER]
})
export class AuthorizationModule {}
