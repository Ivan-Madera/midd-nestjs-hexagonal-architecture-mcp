import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req
} from '@nestjs/common'
import { Request } from 'express'
import { ResponseJsonApiBase } from '../../../../<sharedRoot>/infrastructure/http-server/dto/response-data-json-api-base'
import { CustomHttpException } from '../../../../<sharedRoot>/error-event-management/generic-exception/custom-http-exception'
import { I__Caso__Application } from '../../../core/application/interfaces/__casoKebab__.application.interface'
import { __CASO___APPLICATION } from '../../../core/__dominioKebab__.core.module'
import { __Caso__RequestJsonApiDTO } from '../dto/__casoKebab__-request-json-api.dto'

// MANDATORY convention: kebab-case path and the version declared in the controller
// (the first version is ALWAYS '1'). Final URL: /{context}/api/v1/<ruta-dominio>/__accion__
// where {context} is the global prefix (API_CONTEXT) and `api/v` is set in main.ts.
@Controller({ path: '<ruta-dominio>', version: '1' })
export class __Caso__Controller {
  constructor(
    @Inject(__CASO___APPLICATION)
    private readonly __caso__Application: I__Caso__Application
  ) {}

  @Post('__accion__')
  @HttpCode(200)
  public async __accion__(
    @Body() body: __Caso__RequestJsonApiDTO,
    @Req() req: Request
  ): Promise<ResponseJsonApiBase> {
    try {
      const {
        data: { attributes }
      } = body
      const responseData = await this.__caso__Application.__casoDeUso__(attributes)
      // `links.self` queda como path relativo (req.url): comportamiento del estándar.
      return new ResponseJsonApiBase({
        attributes: responseData,
        type: '<tipo-recurso>',
        links: req?.url
      })
    } catch (error: any) {
      throw new CustomHttpException(
        {
          details: error?.message,
          title: error?.errorResponse?.title,
          code: error?.errorResponse?.code,
          status: error?.errorResponse?.status,
          suggestedActions: error?.errorResponse?.suggestedActions
        },
        error?.errorResponse?.status ?? HttpStatus.INTERNAL_SERVER_ERROR,
        error?.stack
      )
    }
  }
}
