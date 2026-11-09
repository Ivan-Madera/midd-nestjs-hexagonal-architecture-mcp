import { registerAs } from '@nestjs/config'

/**
 * Single source of configuration: nothing reads process.env outside this file (read lazily, after Joi).
 */
export default registerAs('ConfigurationVariables', () => {
  return {
    database: {
      // One entry per connection (DB_<CONNECTION>_*).
    },
    server: {
      Port: process.env.PORT,
      // {context} of the base URL /{context}/api/v{N}/{resource}.
      ApiContext: process.env.API_CONTEXT
    },
    security: {
      corsAllowedOrigins: (process.env.CORS_ALLOWED_ORIGINS ?? '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
      rateLimit: {
        maxRequestsPerWindow: Number(process.env.RL_MAX_REQUESTS_PER_WINDOW),
        windowSeconds: Number(process.env.RL_WINDOW_SECONDS),
        maxConcurrentPerIp: Number(process.env.RL_MAX_CONCURRENT_PER_IP),
        maxPayloadBytes: Number(process.env.RL_MAX_PAYLOAD_BYTES),
        maxJsonPayloadBytes: Number(process.env.RL_MAX_JSON_PAYLOAD_BYTES),
        cacheTtlMs: Number(process.env.RL_CACHE_TTL_MS),
        cacheMaxEntries: Number(process.env.RL_CACHE_MAX_ENTRIES),
        trustedProxies: process.env.RL_TRUSTED_PROXIES ?? ''
      }
    },
    externalApis: {
      // One entry per external API consumed by an http adapter, added by add_use_case:
      // ExchangeRates: { baseUrl: process.env.EXCHANGE_RATES_BASE_URL }
    },
    storedProcedures: {
      // Declare here the SP names read from env, e.g.:
      // ValidateProductType: process.env.VALIDATE_PRODUCT_TYPE
    }
  }
})
