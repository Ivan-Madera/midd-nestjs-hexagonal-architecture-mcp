import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable
} from '@nestjs/common'
import { ConfigType } from '@nestjs/config'
import { Request, Response } from 'express'
import ConfigurationVariables from '../config/configuration-variables'
import { TtlCache } from './ttl-cache'
import { parseTrustedCidrs, resolveClientIp, TrustedCidr } from './ip-resolver'

type FixedWindow = { count: number; windowStartedAt: number }
type InFlight = { count: number }

/**
 * Controls C1 and C2 of the mandatory rate limiting baseline:
 *  - C1: max requests per IP in a FIXED window (token bucket with full refill).
 *        Exceeding it answers 429 + Retry-After.
 *  - C2: max concurrent in-flight requests per IP. The counter is released when
 *        the response finishes or the connection closes (also on errors).
 * C3 (payload size) lives in payloadSize.middleware.ts. Register this guard
 * BEFORE any authorization guard so floods never reach the authorizer.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly windows: TtlCache<FixedWindow>
  private readonly inFlight: TtlCache<InFlight>
  private readonly trustedProxies: TrustedCidr[]
  private readonly limits: ConfigType<typeof ConfigurationVariables>['security']['rateLimit']

  constructor(
    @Inject(ConfigurationVariables.KEY)
    config: ConfigType<typeof ConfigurationVariables>
  ) {
    this.limits = config.security.rateLimit
    this.windows = new TtlCache(this.limits.cacheTtlMs, this.limits.cacheMaxEntries)
    this.inFlight = new TtlCache(this.limits.cacheTtlMs, this.limits.cacheMaxEntries)
    this.trustedProxies = parseTrustedCidrs(this.limits.trustedProxies)
  }

  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp()
    const req = http.getRequest<Request>()
    const res = http.getResponse<Response>()

    if (this.isExcluded(req)) return true

    const ip = resolveClientIp(req, this.trustedProxies)
    this.consumeWindow(ip, res)
    this.acquireSlot(ip, res)
    return true
  }

  private isExcluded(req: Request): boolean {
    const path = req.path ?? req.url
    return path === '/' || path.startsWith('/actuator')
  }

  private consumeWindow(ip: string, res: Response): void {
    const now = Date.now()
    const windowMs = this.limits.windowSeconds * 1000
    const current = this.windows.get(ip)
    const window =
      current && now - current.windowStartedAt < windowMs
        ? current
        : { count: 0, windowStartedAt: now }

    window.count += 1
    this.windows.set(ip, window)

    if (window.count > this.limits.maxRequestsPerWindow) {
      res.setHeader('Retry-After', String(this.limits.windowSeconds))
      throw this.tooManyRequests(
        'SERVICE-TOOMANYREQUESTS-017',
        'Too many requests',
        'The request rate limit for this IP was exceeded.',
        `Wait ${this.limits.windowSeconds} seconds before retrying.`
      )
    }
  }

  private acquireSlot(ip: string, res: Response): void {
    const slot = this.inFlight.get(ip) ?? { count: 0 }
    if (slot.count >= this.limits.maxConcurrentPerIp) {
      throw this.tooManyRequests(
        'SERVICE-TOOMANYCONCURRENT-018',
        'Too many concurrent requests',
        'The concurrent requests limit for this IP was exceeded.',
        'Wait for your in-flight requests to finish before sending more.'
      )
    }

    slot.count += 1
    this.inFlight.set(ip, slot)

    let released = false
    const release = (): void => {
      if (released) return
      released = true
      const latest = this.inFlight.get(ip)
      if (latest) latest.count = Math.max(0, latest.count - 1)
    }
    res.once('finish', release)
    res.once('close', release)
  }

  private tooManyRequests(
    code: string,
    title: string,
    details: string,
    suggestedActions: string
  ): HttpException {
    return new HttpException(
      { status: HttpStatus.TOO_MANY_REQUESTS, title, details, suggestedActions, code },
      HttpStatus.TOO_MANY_REQUESTS
    )
  }
}
