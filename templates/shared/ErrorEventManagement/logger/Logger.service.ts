import log4js from 'log4js'
import { getCorrelationId } from '../../infrastructure/observability/correlationContext'

class LoggerService {
  #logger: any

  constructor() {
    log4js.configure({
      appenders: {
        stdout: {
          type: 'stdout'
        }
      },
      categories: { default: { appenders: ['stdout'], level: 'debug' } }
    })

    this.#logger = log4js.getLogger('LogService')
  }

  // Every line carries the request correlation id so a whole request can be traced.
  #stamp(message: string): string {
    const correlationId = getCorrelationId()
    return correlationId ? `[${correlationId}] ${message}` : message
  }

  info(message: string): void {
    this.#logger.info(this.#stamp(message))
  }

  warn(message: string): void {
    this.#logger.warn(this.#stamp(message))
  }

  error(message: string): void {
    this.#logger.error(this.#stamp(message))
  }

  debug(message: string): void {
    this.#logger.debug(this.#stamp(message))
  }
}

export default new LoggerService()
