import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { Request } from 'express'
import { AUTH_ERRORS, authorizationException } from './authorization.errors'
import { IAuthorizationVerifier } from './domain/IAuthorizationVerifier'
import { SKIP_AUTHORIZATION } from './skip-authorization.decorator'
import { AUTHORIZATION_VERIFIER } from './authorization.tokens'

/**
 * GLOBAL guard (secure-by-default): protects every endpoint unless it is marked
 * @SkipAuthorization(). FAIL-CLOSED: a denial, or an unreachable authorizer, is a 403.
 * It must run AFTER the rate limit guard so a flood is dropped (429) without
 * spending authorization calls (see SecurityModule / AuthorizationModule order).
 * The HTTP-call logic lives in the adapter behind the port, never here.
 */
@Injectable()
export class AuthorizationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(AUTHORIZATION_VERIFIER)
    private readonly verifier: IAuthorizationVerifier
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_AUTHORIZATION, [
      context.getHandler(),
      context.getClass()
    ])
    if (skip) return true

    const bearerToken = this.extractBearer(context)
    if (!bearerToken) throw authorizationException(AUTH_ERRORS.MISSING_TOKEN)

    const { allowed } = await this.verifier.authorize({ bearerToken })
    if (!allowed) throw authorizationException(AUTH_ERRORS.FORBIDDEN)
    return true
  }

  private extractBearer(context: ExecutionContext): string | null {
    const header = context.switchToHttp().getRequest<Request>().headers?.authorization
    return header?.startsWith('Bearer ') ? header.slice(7).trim() || null : null
  }
}
