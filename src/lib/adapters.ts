/**
 * The three ways a use case reaches its data source.
 * - typeorm: a TypeORM repository (the default).
 * - sp:      a stored procedure (opt-in).
 * - http:    an external API consumed with the native fetch through `consumoHttp`. It needs no database at all.
 */
export const ADAPTERS = ['typeorm', 'sp', 'http'] as const
export type AdapterType = (typeof ADAPTERS)[number]
export const isAdapterType = (value: unknown): value is AdapterType =>
  typeof value === 'string' && (ADAPTERS as readonly string[]).includes(value)

/** Adapters that read a database, so they need a connection. */
export const usesDatabase = (adapter: AdapterType): boolean => adapter !== 'http'

export const HTTP_VERBS = ['GET', 'POST', 'PUT'] as const
export type HttpVerb = (typeof HTTP_VERBS)[number]
export const isHttpVerb = (value: unknown): value is HttpVerb =>
  typeof value === 'string' && (HTTP_VERBS as readonly string[]).includes(value)

/** Name of the environment variable that holds the base URL of an external API: ExchangeRates -> EXCHANGE_RATES_BASE_URL. */
export function envVarApiBaseUrl(api: string): string {
  const snake = api
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .toUpperCase()
  return `${snake}_BASE_URL`
}

/**
 * The call the adapter makes, as source text (the template and the extra methods share it).
 * GET sends the request as query string, POST and PUT send it as the JSON body. The path is joined to the base
 * URL by the adapter's own `url()` helper, so a trailing slash in the base URL never doubles.
 */
export function httpCallExpression(verb: HttpVerb, path: string): string {
  const target = `this.url('${path.replace(/'/g, "\\'")}')`
  if (verb === 'GET') return `get(${target}, { params: data as unknown as Record<string, string | number | boolean> })`
  return `${verb.toLowerCase()}(${target}, data)`
}

/** A path of the external API: starts with "/", no spaces, no quotes. Query strings belong to the request fields. */
export const isApiPath = (value: unknown): value is string => typeof value === 'string' && /^\/[A-Za-z0-9._~\-/{}:]*$/.test(value)
