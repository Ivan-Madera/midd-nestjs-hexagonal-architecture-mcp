import { registerAs } from '@nestjs/config'

/**
 * Single source of configuration of the service. It structures the environment
 * variables into typed objects. NOTHING may read process.env outside this file.
 *
 * Canonical base: add the groups the service needs (external apis, suppliers,
 * storedProcedures, etc.) keeping this pattern. Values are read lazily (inside
 * the factory), after ConfigModule has loaded and validated the .env.
 */
export default registerAs('ConfigurationVariables', () => {
  return {
    database: {
      // One entry per connection, added by scaffold_service and add_use_case. Each entry reads the
      // variables DB_<CONNECTION>_HOST, _PORT, _USERNAME, _PASSWORD and _NAME.
    },
    server: {
      Port: process.env.PORT,
      // {context} of the base URL /{context}/api/v{N}/{resource}.
      ApiContext: process.env.API_CONTEXT
    },
    security: {
      // Concrete list of allowed origins, comma separated. Never '*'.
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
    storedProcedures: {
      // Declare here the SP names read from env, e.g.:
      // ValidateProductType: process.env.VALIDATE_PRODUCT_TYPE
    }
  }
})
