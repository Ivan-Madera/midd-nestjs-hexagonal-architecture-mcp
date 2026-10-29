import { SetMetadata } from '@nestjs/common'

export const SKIP_AUTHORIZATION = 'skipAuthorization'

/**
 * Opt-OUT for a genuinely public endpoint (health check, inbound webhook).
 * Everything is protected by default; a missing mark means protected, so an
 * omission is never an accidental hole. Never put it on a whole domain
 * controller just to simplify: that defeats secure-by-default.
 */
export const SkipAuthorization = () => SetMetadata(SKIP_AUTHORIZATION, true)
