export const __Dominio__DomainError = {
  '__ERROR_KEY__': {
    message: 'No se encontró <ENTIDAD_TXT> con los parámetros enviados.',
    code: '<PREFIJO>-<SLUG>-<ERR_NUM_DOM>',
    title: '<ENTIDAD_TXT_CAP> no encontrado.',
    status: 404,
    suggestedActions: 'Valide los parámetros enviados e intente nuevamente.'
  },
  default: {
    message: 'Mensaje genérico de fallo.',
    code: '<PREFIJO>-GENERIC-000',
    title: 'Error',
    status: 500,
    suggestedActions: 'Revise los logs del servicio.'
  }
}
