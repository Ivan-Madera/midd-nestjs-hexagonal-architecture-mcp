import { Inject, Injectable } from '@nestjs/common'
import { ConfigType } from '@nestjs/config'
import ConfigurationVariables from '../../infrastructure/config/ConfigurationVariables'
import { consumoHttp } from '../../utils/services/consumoHttp'
import {
  AuthorizationDecision,
  AuthorizationRequest,
  IAuthorizationVerifier
} from '../domain/IAuthorizationVerifier'

/**
 * Default production adapter: asks the Macropay authorization API whether the
 * front's Bearer token is valid. It is just ONE adapter behind the agnostic port.
 *
 * It only translates transport/status into a decision: it never throws the 403
 * itself (the guard owns that) and never leaks the authorizer's response.
 * FAIL-CLOSED: if the authorizer is unreachable the decision is "denied".
 */
@Injectable()
export class MacropayApiAuthorizationVerifier implements IAuthorizationVerifier {
  private readonly http = new consumoHttp()

  constructor(
    @Inject(ConfigurationVariables.KEY)
    private readonly config: ConfigType<typeof ConfigurationVariables>
  ) {}

  async authorize(request: AuthorizationRequest): Promise<AuthorizationDecision> {
    const response = await this.http.post(
      `${this.config.authorization.apiUrl}/auth/validity`,
      '',
      {
        headers: {
          'Content-Type': 'application/vnd.api+json',
          // The FRONT's token forwarded from the incoming request, not an env credential.
          Authorization: `Bearer ${request.bearerToken}`
        }
      }
    )

    // consumoHttp resolves (never throws): no status means the authorizer is unreachable.
    const status: number | undefined = response?.status
    if (status === undefined) return { allowed: false, reason: 'authz unreachable' }
    return status >= 200 && status < 300
      ? { allowed: true }
      : { allowed: false, reason: `authz ${status}` }
  }
}
