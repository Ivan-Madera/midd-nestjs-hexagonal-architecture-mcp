import { IHttpClientService } from '../interfaces/http-client.service.interface'
import Logger from '../../error-event-management/logger/logger.service'
import {
  CORRELATION_HEADER,
  getCorrelationId
} from '../../infrastructure/observability/correlation-context'

export type HttpOptions = {
  headers?: Record<string, string>
  // Appended to the url as a query string.
  params?: Record<string, string | number | boolean>
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 30000
const SENSITIVE_HEADERS = ['authorization', 'cookie', 'proxy-authorization', 'x-api-key']

// Never log credentials: sensitive header values are replaced before logging.
const redactHeaders = (headers: Record<string, string> = {}): Record<string, string> =>
  Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name,
      SENSITIVE_HEADERS.includes(name.toLowerCase()) ? '[REDACTED]' : value
    ])
  )

// The query string may carry tokens: logs only show the url without it.
const withoutQuery = (url: string): string => url.split('?')[0]

/**
 * HTTP client over the native fetch (no axios). Forwards the correlation id.
 * Failures never throw: they resolve to { status, data: null, statusText, responseErrorApi }.
 */
export class HttpClientService implements IHttpClientService {
  async get(url: string, options?: HttpOptions): Promise<any> {
    return this.request('GET', url, undefined, options)
  }

  async post(url: string, body?: any, options?: HttpOptions): Promise<any> {
    return this.request('POST', url, body, options)
  }

  async put(url: string, body?: any, options?: HttpOptions): Promise<any> {
    return this.request('PUT', url, body, options)
  }

  private async request(
    method: string,
    url: string,
    body: any,
    options: HttpOptions = {}
  ): Promise<any> {
    const target = this.buildUrl(url, options.params)
    const headers = this.buildHeaders(options.headers, body)

    try {
      const response = await fetch(target, {
        method,
        headers,
        body: this.serializeBody(body),
        signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
      })
      const data = await this.parseBody(response)

      if (!response.ok) {
        return this.failure(method, target, headers, {
          status: response.status,
          statusText: String(response.status),
          responseErrorApi: data
        })
      }

      return {
        status: response.status,
        statusText: response.statusText,
        data,
        headers: Object.fromEntries(response.headers.entries())
      }
    } catch (error: any) {
      const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError'
      return this.failure(method, target, headers, {
        status: undefined,
        // Network failures expose the system code (ECONNREFUSED, ENOTFOUND...) in `cause`,
        // possibly inside an AggregateError (one entry per resolved address).
        statusText: timedOut
          ? 'ETIMEDOUT'
          : (error?.cause?.code ?? error?.cause?.errors?.[0]?.code ?? error?.name),
        responseErrorApi: undefined,
        message: error?.message
      })
    }
  }

  private buildUrl(url: string, params?: HttpOptions['params']): string {
    if (!params || Object.keys(params).length === 0) return url
    const query = new URLSearchParams(
      Object.entries(params).map(([key, value]) => [key, String(value)])
    ).toString()
    return `${url}${url.includes('?') ? '&' : '?'}${query}`
  }

  private buildHeaders(extra: Record<string, string> = {}, body?: any): Record<string, string> {
    const headers: Record<string, string> = { ...extra }
    const hasContentType = Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')
    if (body !== undefined && typeof body !== 'string' && !hasContentType) {
      headers['Content-Type'] = 'application/json'
    }
    const correlationId = getCorrelationId()
    if (correlationId) headers[CORRELATION_HEADER] = correlationId
    return headers
  }

  private serializeBody(body: any): string | undefined {
    if (body === undefined || body === null) return undefined
    return typeof body === 'string' ? body : JSON.stringify(body)
  }

  // A non-JSON or empty body must never crash the caller.
  private async parseBody(response: Response): Promise<any> {
    const text = await response.text()
    if (!text) return null
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }

  private failure(
    method: string,
    url: string,
    headers: Record<string, string>,
    result: { status?: number; statusText: string; responseErrorApi: any; message?: string }
  ) {
    Logger.error(
      `An error occurred while executing the ${method} method. ${JSON.stringify({
        message: result.message,
        url: withoutQuery(url),
        status: result.status,
        statusText: result.statusText,
        headers: redactHeaders(headers),
        responseErrorApi: result.responseErrorApi
      })}`
    )
    return {
      status: result.status,
      data: null,
      statusText: result.statusText,
      responseErrorApi: result.responseErrorApi
    }
  }
}
