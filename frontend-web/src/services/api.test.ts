import { AxiosError, AxiosHeaders } from 'axios'
import { describe, expect, it } from 'vitest'
import { apiErrorMessage } from './api'

function makeAxiosError(data: unknown, status = 400): AxiosError {
  return new AxiosError('Request failed', 'ERR_BAD_REQUEST', undefined, undefined, {
    data,
    status,
    statusText: 'Bad Request',
    headers: {},
    config: { headers: new AxiosHeaders() },
  })
}

describe('apiErrorMessage', () => {
  it('extracts the error field from the backend envelope', () => {
    const error = makeAxiosError({ error: 'Credenciales invalidas', code: 'UNAUTHORIZED' })
    expect(apiErrorMessage(error)).toBe('Credenciales invalidas')
  })

  it('falls back to a generic message when the response has no error field', () => {
    const error = makeAxiosError({ detail: 'algo distinto' })
    expect(apiErrorMessage(error)).toBe('Ocurrió un error inesperado')
  })

  it('falls back to a generic message for non-axios errors', () => {
    expect(apiErrorMessage(new Error('boom'))).toBe('Ocurrió un error inesperado')
  })
})
