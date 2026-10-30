import { Controller, HttpCode, Post, Req } from '@nestjs/common'
import { Request } from 'express'
import { ResponseJsonApiBase } from '../dto/response-data-json-api-base'

/**
 * Liveness probe, created with every new service so a fresh checkout can prove it starts:
 *
 *   POST /{context}/api/v1/health      Content-Type: application/vnd.api+json
 *
 * It follows the same policy as every endpoint of the area (POST only, JSON:API envelope,
 * version declared in the controller). It answers 200 as soon as the HTTP edge is up and
 * deliberately checks nothing else: a probe that depends on the database would fail for reasons
 * unrelated to the process being alive and would leak internals. It returns no version or host.
 *
 * Authorization: add_authorization marks this handler as public. Without that mark the global
 * guard would answer 401 and the probe would stop being useful.
 */
@Controller({ path: 'health', version: '1' })
export class HealthController {
  @Post()
  @HttpCode(200)
  public check(@Req() req: Request): ResponseJsonApiBase {
    return new ResponseJsonApiBase({
      attributes: { status: 'UP' },
      type: 'health',
      links: req?.url
    })
  }
}
