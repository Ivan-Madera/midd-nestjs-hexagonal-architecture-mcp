import { NextFunction, Request, Response } from 'express'

/**
 * Cache-Control: no-store on EVERY response (mandatory security baseline).
 * Register it as the FIRST middleware so rejections produced by guards
 * (401/403/429) and by other middlewares also carry the header.
 */
export function cacheControlNoStore(
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  res.setHeader('Cache-Control', 'no-store')
  next()
}
