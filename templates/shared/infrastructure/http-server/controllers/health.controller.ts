import { Controller, HttpCode, Post, Req } from '@nestjs/common'
import { Request } from 'express'
import { ResponseJsonApiBase } from '../dto/response-data-json-api-base'

/**
 * Liveness probe: POST /{context}/api/v1/health answers 200 as soon as the HTTP edge is up.
 * It checks nothing else on purpose (a database check fails for unrelated reasons and leaks internals).
 * With authorization enabled it must stay public, or it answers 401.
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
