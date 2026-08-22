import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/services/api'
import type {
  ApiSuccess,
  Debt,
  DebtDirection,
  DebtSummary,
  DebtType,
  PaymentFrequency,
  UnplannedDebt,
} from '@/types'

/** Cualquier mutacion de deudas puede tocar listas (por direccion), resumen,
 * proximos pagos y sin-plan a la vez -- mas simple invalidar todo ['debts']
 * que mantener parches manuales de cache por cada variante de queryKey. */
function invalidateDebts(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['debts'] })
}

export function useUnplannedDebts() {
  return useQuery({
    queryKey: ['debts', 'unplanned'],
    queryFn: async () => {
      const { data } = await api.get<ApiSuccess<UnplannedDebt[]>>('/debts/unplanned')
      return data.data
    },
  })
}

export function useDebts(direction?: DebtDirection) {
  return useQuery({
    queryKey: ['debts', 'list', direction ?? 'all'],
    queryFn: async () => {
      const { data } = await api.get<ApiSuccess<Debt[]>>('/debts', { params: { direction } })
      return data.data
    },
  })
}

export function useDebtSummary() {
  return useQuery({
    queryKey: ['debts', 'summary'],
    queryFn: async () => {
      const { data } = await api.get<ApiSuccess<DebtSummary>>('/debts/summary')
      return data.data
    },
  })
}

export interface CreateUnplannedDebtInput {
  name: string
  creditor?: string
  amount: string
  direction: DebtDirection
  notes?: string
}

export function useCreateUnplannedDebt() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateUnplannedDebtInput) => {
      const { data } = await api.post<ApiSuccess<UnplannedDebt>>('/debts/unplanned', input)
      return data.data
    },
    onSuccess: () => invalidateDebts(queryClient),
  })
}

export interface ActivateDebtInput {
  agreed_amount?: string
  payment_amount: string
  payment_frequency: PaymentFrequency
  payment_day?: number
  total_installments?: number
  linked_account_id?: string
  /** Cuenta real donde ya entro/salio el efectivo de este prestamo -- la
   * deuda sin plan nunca toca balances por diseno, esta es la primera
   * oportunidad de registrar el movimiento real. */
  funding_account_id?: string
  start_date: string
  due_date?: string
}

export function useActivateUnplannedDebt() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: ActivateDebtInput }) => {
      const { data } = await api.post<ApiSuccess<Debt>>(`/debts/unplanned/${id}/activate`, input)
      return data.data
    },
    onSuccess: (_debt, { input }) => {
      invalidateDebts(queryClient)
      if (input.funding_account_id) {
        queryClient.invalidateQueries({ queryKey: ['accounts'] })
        queryClient.invalidateQueries({ queryKey: ['transactions'] })
      }
    },
  })
}

export interface CreateDebtInput {
  name: string
  creditor?: string
  type: DebtType
  direction: DebtDirection
  total_amount: string
  current_balance?: string
  payment_amount?: string
  payment_frequency?: PaymentFrequency
  total_installments?: number
  linked_account_id?: string
  /** Cuenta real donde ya entro/salio el efectivo al originar esta deuda. */
  funding_account_id?: string
  start_date?: string
  is_shared?: boolean
  responsible_party?: string
}

export function useCreateDebt() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateDebtInput) => {
      const { data } = await api.post<ApiSuccess<Debt>>('/debts', input)
      return data.data
    },
    onSuccess: (_debt, input) => {
      invalidateDebts(queryClient)
      // funding_account_id es el unico caso que genera una transaccion real
      // -- ahi si cambian cuentas/transacciones.
      if (input.funding_account_id) {
        queryClient.invalidateQueries({ queryKey: ['accounts'] })
        queryClient.invalidateQueries({ queryKey: ['transactions'] })
      }
    },
  })
}

export interface UpdateDebtInput {
  name?: string
  payment_amount?: string
  payment_frequency?: PaymentFrequency
  payment_day?: number
  next_payment_date?: string
  linked_account_id?: string
  payment_source_account_id?: string
  notes?: string
  /** Correccion manual del saldo pendiente -- current_balance es la unica
   * fuente de verdad del saldo de una deuda (a diferencia de Account, que
   * tiene un initial_balance separado), asi que esto ajusta directo, no por
   * delta. Pensado para corregir el saldo despues de un backfill historico. */
  current_balance?: string
}

/** PUT /debts/{id} (backend/app/routers/debts.py) ya existia listo desde
 * siempre -- lo unico que faltaba era que el frontend lo usara. Hoy solo lo
 * consume CorrectBalanceForm en Debts.tsx, pero sirve para cualquier campo de
 * DebtUpdate. */
export function useUpdateDebt() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: UpdateDebtInput }) => {
      const { data } = await api.put<ApiSuccess<Debt>>(`/debts/${id}`, input)
      return data.data
    },
    onSuccess: () => invalidateDebts(queryClient),
  })
}

export interface RegisterDebtPaymentInput {
  account_id: string
  amount: string
  date: string
  notes?: string
}

export function useRegisterDebtPayment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ debtId, input }: { debtId: string; input: RegisterDebtPaymentInput }) => {
      const { data } = await api.post(`/debts/${debtId}/payments`, input)
      return data.data
    },
    onSuccess: () => {
      invalidateDebts(queryClient)
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
    },
  })
}
