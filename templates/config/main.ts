import { NestFactory } from '@nestjs/core'
import { ValidationPipe, VersioningType } from '@nestjs/common'
import { ConfigType } from '@nestjs/config'
import { json, NextFunction, Request, Response } from 'express'
import helmet from 'helmet'
import { AppModule } from './app.module'
import ConfigurationVariables from './shared/infrastructure/config/configuration-variables'
import { AllExceptionsFilter } from './shared/infrastructure/http-server/exception-filters/generic-exception-filter'
import { ValidationHeaderMiddleware } from './shared/infrastructure/http-server/middlewares/validation-header.middleware'
import { correlationMiddleware } from './shared/infrastructure/observability/correlation.middleware'
import { cacheControlNoStore } from './shared/infrastructure/security/cache-control.middleware'
import { createPayloadSizeMiddleware } from './shared/infrastructure/security/payload-size.middleware'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  const config = app.get<ConfigType<typeof ConfigurationVariables>>(
    ConfigurationVariables.KEY
  )
  const { server, security } = config

  // --- MANDATORY HTTP edge (order matters, outermost first) ---------------
  // 1. Cache-Control: no-store on EVERY response (also on rejections).
  app.use(cacheControlNoStore)
  // 2. Correlation id (caller-independent): logs, outbound calls and errors.
  app.use(correlationMiddleware)
  // 3. Payload size (control C3): reject before parsing the body.
  app.use(
    createPayloadSizeMiddleware({
      maxBytes: security.rateLimit.maxPayloadBytes,
      maxJsonBytes: security.rateLimit.maxJsonPayloadBytes
    })
  )
  // 4. Security headers required by Cybersecurity.
  app.use(
    helmet({
      hsts: { maxAge: 31536000, includeSubDomains: true },
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"]
        }
      },
      noSniff: true,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      frameguard: { action: 'deny' }
    })
  )
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    res.removeHeader('X-Powered-By')
    next()
  })
  // 5. CORS from CORS_ALLOWED_ORIGINS. `cors` only treats the STRING '*' as a wildcard, hence the check.
  const allowAnyOrigin = security.corsAllowedOrigins.includes('*')
  app.enableCors({
    origin: allowAnyOrigin ? '*' : security.corsAllowedOrigins,
    methods: ['POST'],
    allowedHeaders: ['Authorization', 'Content-Type', 'x-correlation-id'],
    exposedHeaders: ['x-correlation-id', 'Retry-After']
  })

  // Base URL /{context}/api/v{N}/{resource}: the version lives in each controller.
  app.setGlobalPrefix(server.ApiContext)
  app.enableVersioning({
    type: VersioningType.URI,
    prefix: 'api/v',
    defaultVersion: '1'
  })
  app.use(
    json({
      type: 'application/vnd.api+json',
      limit: security.rateLimit.maxJsonPayloadBytes
    })
  )

  app.useGlobalFilters(new AllExceptionsFilter())
  app.use(new ValidationHeaderMiddleware().use)

  app.useGlobalPipes(
    new ValidationPipe({
      stopAtFirstError: true,
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true
    })
  )

  await app.listen(server.Port)
}
bootstrap()
