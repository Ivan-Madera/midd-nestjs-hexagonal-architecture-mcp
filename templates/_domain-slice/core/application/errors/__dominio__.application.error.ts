export const __Dominio__ApplicationError = {
  '__ERROR_KEY__': {
    code: '<PREFIJO>-<SLUG>-<ERR_NUM_APP>',
    title: 'No se pudo procesar la solicitud de <ENTIDAD_TXT>.',
    status: 400,
    suggestedActions: 'Revise la información enviada e intente nuevamente.'
  },
  default: {
    code: '<PREFIJO>-GENERIC-000',
    title: 'Error',
    status: 500,
    suggestedActions: 'Revise los logs del servicio.'
  }
}
