import Joi from 'joi'

/**
 * Environment variables validation schema. ALL the variables the service
 * consumes must be declared here. Keep it in sync with ConfigurationVariables.ts
 * and .env.example.
 *
 * Canonical base: extend it with the service specific variables.
 */
export const configValidationSchema = Joi.object({
  // Server
  PORT: Joi.number().default(3000).required(),
  // {context} of the base URL /{context}/api/v{N}/{resource}. Routes break without it.
  API_CONTEXT: Joi.string().required(),

  // Database connections: one block of DB_<CONNECTION>_* variables per connection,
  // added by scaffold_service and add_use_case.

  // HTTP security (mandatory baseline). Comma separated list of allowed origins.
  // Defaults to '*' (any origin, tolerated for server-to-server middleware); set
  // concrete origins in the env var once they are defined.
  CORS_ALLOWED_ORIGINS: Joi.string().default('*'),
  RL_MAX_REQUESTS_PER_WINDOW: Joi.number().default(150),
  RL_WINDOW_SECONDS: Joi.number().default(5),
  RL_MAX_CONCURRENT_PER_IP: Joi.number().default(20),
  RL_MAX_PAYLOAD_BYTES: Joi.number().default(8388608),
  RL_MAX_JSON_PAYLOAD_BYTES: Joi.number().default(2097152),
  RL_CACHE_TTL_MS: Joi.number().default(600000),
  RL_CACHE_MAX_ENTRIES: Joi.number().default(100000),
  RL_TRUSTED_PROXIES: Joi.string().default('10.0.0.0/8,172.16.0.0/12,192.168.0.0/16'),

  // Add here the rest of the service variables (external apis, SPs, etc.)
})
