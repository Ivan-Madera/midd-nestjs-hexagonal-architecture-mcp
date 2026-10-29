import { __Caso__ApplicationService } from './__caso__.application'
import { I__Caso__Service } from '../../domain/ports/inbound/I__Caso__Service'

describe('__Caso__ApplicationService', () => {
  let service: __Caso__ApplicationService
  let depMock: jest.Mocked<I__Caso__Service>

  beforeEach(() => {
    depMock = {
      __metodo__: jest.fn()
    } as unknown as jest.Mocked<I__Caso__Service>
    service = new __Caso__ApplicationService(depMock)
  })

  it('ejecuta el caso de uso correctamente', async () => {
    const fixture = {} as any
    const attributes = { __param__: 'valor' } as any
    depMock.__metodo__.mockResolvedValue(fixture)

    const result = await service.__casoDeUso__(attributes)

    expect(depMock.__metodo__).toHaveBeenCalledWith(attributes)
    expect(result).toBe(fixture)
  })

  it('propaga la excepción cuando el servicio de dominio falla', async () => {
    depMock.__metodo__.mockRejectedValue(new Error('fallo'))

    await expect(
      service.__casoDeUso__({ __param__: 'valor' } as any)
    ).rejects.toThrow()
  })
})
