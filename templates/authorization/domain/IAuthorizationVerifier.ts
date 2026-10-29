export interface AuthorizationRequest {
  // Token the FRONT sent (taken from the incoming Authorization header).
  bearerToken: string
  // Extensible (route, method, ...) without breaking the contract.
  context?: Record<string, unknown>
}

export interface AuthorizationDecision {
  allowed: boolean
  // For server-side logs/telemetry ONLY: never returned to the client.
  reason?: string
}

/**
 * Verifier capability port. The edge guard depends on this abstraction, never
 * on the concrete authorizer: swapping the implementation (another API, a local
 * JWT check, gRPC) only changes the adapter and the binding in the module.
 * It returns a decision (not a bare boolean) so it can grow without breaking callers.
 */
export interface IAuthorizationVerifier {
  authorize(request: AuthorizationRequest): Promise<AuthorizationDecision>
}
