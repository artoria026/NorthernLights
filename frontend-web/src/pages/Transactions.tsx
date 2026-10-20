import { ArrowLeftRight, Check, ChevronLeft, ChevronRight, CreditCard, Pencil, Plus, Trash2, UserPlus, Users } from 'lucide-react'
import { type FormEvent, useMemo, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CategorySelect } from '@/components/nl/CategorySelect'
import { PageSizeSelect } from '@/components/nl/PageSizeSelect'
import { TagChip } from '@/components/nl/TagChip'
import { TagPicker } from '@/components/nl/TagPicker'
import { useBulkTag, useTags } from '@/hooks/useTags'
import { usePageSize } from '@/hooks/usePageSize'
import { summarizeTransactions } from '@/lib/transactionTotals'
import { DialogFooter, DialogPrimaryButton } from '@/components/nl/DialogActions'
import { EditTransactionModal } from '@/components/nl/EditTransactionModal'
import { DemoFlow, HelpSection, HelpTip } from '@/components/nl/Help'
import { CategoryBadge, HEADER_SECTIONS, SegmentedControl, ViewHeader } from '@/components/nl/primitives'
import { PayCreditCardForm } from '@/components/nl/PayCreditCardForm'
import { TransactionsCalendar } from '@/components/nl/TransactionsCalendar'
import { useAccounts } from '@/hooks/useAccounts'
import { useCategories } from '@/hooks/useCategories'
import { useDebts } from '@/hooks/useDebts'
import { useAllTransactions, useCreateSplitExpense, useDeleteTransaction } from '@/hooks/useTransactions'
import { apiErrorMessage } from '@/services/api'
import {
  entryTypeLabel,
  formatMoney as formatMoneyBase,
  isPositiveEntryType,
  isTransactionEditable,
  selectClass,
} from '@/lib/utils'
import { useConfirmStore } from '@/stores/confirmStore'
import { useTransactionModalStore } from '@/stores/transactionModalStore'
import { useUiStore } from '@/stores/uiStore'
import type { Transaction } from '@/types'

type TypeFilter = 'ALL' | 'INCOME' | 'EXPENSE' | 'TRANSFER'

// Transactions table (lg+): select | date | description | account | category | amount | actions.
// The amount has a fixed width and the text columns use minmax(0, ...), so a long
// description/account/category is cut instead of pushing the amount out of line.
const TRANSACTION_COLUMNS =
  'lg:grid-cols-[20px_90px_minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_7rem_90px]'

function formatMoney(value: string | null) {
  return value ? formatMoneyBase(value) : '—'
}

interface DebtorRow {
  person_name: string
  amount: string
}

function SplitExpenseForm({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation('pages')
  const { data: accounts } = useAccounts()
  const { data: categories } = useCategories('expense')
  const { data: receivables } = useDebts('owed_to_me')
  const createSplit = useCreateSplitExpense()

  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [description, setDescription] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [payingAccountId, setPayingAccountId] = useState('')
  const [myShare, setMyShare] = useState('')
  const [debtors, setDebtors] = useState<DebtorRow[]>([{ person_name: '', amount: '' }])

  function updateDebtor(index: number, patch: Partial<DebtorRow>) {
    setDebtors((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  function addDebtor() {
    setDebtors((rows) => [...rows, { person_name: '', amount: '' }])
  }

  function removeDebtor(index: number) {
    setDebtors((rows) => rows.filter((_, i) => i !== index))
  }

  const total = (Number(myShare) || 0) + debtors.reduce((sum, d) => sum + (Number(d.amount) || 0), 0)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const validDebtors = debtors.filter((d) => d.person_name.trim() && d.amount)
    if (!categoryId || !payingAccountId || !myShare || validDebtors.length === 0) return

    try {
      await createSplit.mutateAsync({
        date,
        description,
        category_id: categoryId,
        paying_account_id: payingAccountId,
        my_share: myShare,
        debtors: validDebtors.map((d) => ({ person_name: d.person_name.trim(), amount: d.amount })),
      })
      onDone()
    } catch {
      // error shown below
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">{t('transactions.fields.date')}</label>
        <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className={`${selectClass} h-9 w-full`} />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">{t('transactions.fields.description')}</label>
        <input
          required
          placeholder={t('transactions.form.descriptionPlaceholder')}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className={`${selectClass} h-9 w-full`}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">{t('transactions.fields.category')}</label>
        <CategorySelect
          categories={categories}
          value={categoryId}
          onValueChange={setCategoryId}
          placeholder={t('transactions.form.categoryPlaceholder')}
          triggerClassName="h-9 w-full"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">{t('transactions.form.payingAccount')}</label>
        <Select value={payingAccountId || null} onValueChange={(v) => setPayingAccountId(v ?? '')}>
          <SelectTrigger className="h-9 w-full">
            <SelectValue placeholder={t('transactions.form.accountPlaceholder')}>
              {(v: string | null) => accounts?.find((a) => a.id === v)?.name}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {accounts?.map((account) => (
              <SelectItem key={account.id} value={account.id}>
                {account.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">{t('transactions.form.myShare')}</label>
        <input
          type="number"
          step="0.01"
          required
          value={myShare}
          onChange={(e) => setMyShare(e.target.value)}
          className={`${selectClass} h-9 w-full`}
        />
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-xs text-muted-foreground">{t('transactions.form.debtors')}</label>
        {debtors.map((debtor, index) => (
          <div key={index} className="flex gap-2 items-center">
            <input
              required
              list="split-debtor-names"
              placeholder={t('transactions.form.debtorNamePlaceholder')}
              className={`${selectClass} h-9 flex-1`}
              value={debtor.person_name}
              onChange={(e) => updateDebtor(index, { person_name: e.target.value })}
            />
            <input
              type="number"
              step="0.01"
              required
              className={`${selectClass} h-9 w-28`}
              placeholder={t('transactions.form.debtorAmountPlaceholder')}
              value={debtor.amount}
              onChange={(e) => updateDebtor(index, { amount: e.target.value })}
            />
            {debtors.length > 1 && (
              <button
                type="button"
                onClick={() => removeDebtor(index)}
                className="rounded px-2.5 py-1.5 text-xs border border-border text-muted-foreground hover:text-foreground"
              >
                {t('transactions.form.removeDebtor')}
              </button>
            )}
          </div>
        ))}
        <datalist id="split-debtor-names">
          {receivables?.map((r) => <option key={r.id} value={r.name} />)}
        </datalist>
        <button
          type="button"
          onClick={addDebtor}
          className="w-fit flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs border border-border text-muted-foreground hover:text-foreground"
        >
          <UserPlus size={13} />
          {t('transactions.form.addDebtor')}
        </button>
      </div>

      <p className="text-sm text-muted-foreground">
        {t('transactions.totalCharge', {
          account: accounts?.find((a) => a.id === payingAccountId)?.name ?? t('transactions.form.accountFallback'),
          amount: total.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' }),
        })}
      </p>

      {createSplit.isError && <p className="text-sm text-destructive">{apiErrorMessage(createSplit.error)}</p>}
      <DialogFooter>
        <DialogPrimaryButton icon={Check} pending={createSplit.isPending}>
          {t('transactions.form.submit')}
        </DialogPrimaryButton>
      </DialogFooter>
    </form>
  )
}

function txType(tx: Transaction): TypeFilter {
  if (tx.entry_type === 'income') return 'INCOME'
  if (tx.entry_type === 'expense') return 'EXPENSE'
  return 'TRANSFER'
}

const TOTAL_TONE_COLOR = {
  income: 'var(--nl-accent-ink)',
  positive: 'var(--nl-accent-ink)',
  expense: 'var(--nl-danger-ink)',
  negative: 'var(--nl-danger-ink)',
} as const

function TotalChip({
  label,
  value,
  count,
  tone,
}: {
  label: string
  value: string
  count?: number
  /** Color of the amount: income (green), expense (red), or by sign for the net -- green above
   * zero, red below it and neutral at exactly zero. */
  tone?: 'income' | 'expense' | 'positive' | 'negative' | 'neutral'
}) {
  const { t } = useTranslation('pages')
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className="font-semibold tabular-nums"
        style={tone && tone !== 'neutral' ? { color: TOTAL_TONE_COLOR[tone] } : undefined}
      >
        {value}
      </dd>
      {count !== undefined && (
        <dd className="text-[11px] text-muted-foreground">({t('transactions.totals.movements', { count })})</dd>
      )}
    </div>
  )
}

function TransactionRow({
  tx,
  accountName,
  categoryColorById,
  onEdit,
  selected,
  onToggleSelected,
}: {
  tx: Transaction
  accountName: string
  categoryColorById: Map<string, string>
  onEdit: (tx: Transaction) => void
  selected: boolean
  /** Only expenses can be tagged, so only they can be selected. */
  onToggleSelected?: (id: string) => void
}) {
  const { t } = useTranslation('pages')
  const deleteTransaction = useDeleteTransaction()
  const pushToast = useUiStore((s) => s.pushToast)
  const confirm = useConfirmStore((s) => s.ask)
  const editable = isTransactionEditable(tx)
  const selectBox = onToggleSelected ? (
    <input
      type="checkbox"
      checked={selected}
      onChange={() => onToggleSelected(tx.id)}
      aria-label={t('transactions.tags.selectRow', { description: tx.description })}
      className="h-3.5 w-3.5 cursor-pointer accent-[var(--nl-accent)]"
    />
  ) : null
  // In the table the first tag sits on the description's own line (the row keeps its
  // height) and the rest collapse into "+N" with all the names on hover.
  const [firstTag, ...otherTags] = tx.tags
  const tagChipsInline = firstTag ? (
    <span className="flex flex-shrink-0 items-center gap-1">
      <TagChip name={firstTag.name} color={firstTag.color} compact />
      {otherTags.length > 0 && (
        <span
          title={otherTags.map((tag) => tag.name).join(', ')}
          className="rounded-full border border-border px-1.5 text-[10.5px] leading-4 text-muted-foreground"
          style={{ background: 'var(--nl-bg-input)' }}
        >
          +{otherTags.length}
        </span>
      )}
    </span>
  ) : null
  const tagChips =
    tx.tags.length > 0 ? (
      <span className="flex flex-wrap gap-1">
        {tx.tags.map((tag) => (
          <TagChip key={tag.id} name={tag.name} color={tag.color} compact />
        ))}
      </span>
    ) : null

  async function handleDelete() {
    const ok = await confirm({
      title: t('transactions.confirmDelete.title'),
      message: t('transactions.confirmDelete.message', { description: tx.description }),
      confirmLabel: t('transactions.actions.delete'),
      variant: 'danger',
    })
    if (!ok) return
    try {
      await deleteTransaction.mutateAsync(tx.id)
    } catch (error) {
      pushToast(apiErrorMessage(error), 'error')
    }
  }

  return (
    <>
      {/* Table row -- lg+ only. The same info in 6 fixed-width columns
          doesn't fit on a phone, that's why there's a separate version
          below. */}
      <div className={`hidden lg:grid ${TRANSACTION_COLUMNS} gap-2 items-center px-3 py-2.5 text-[13px] border-t border-border`}>
        <span>{selectBox}</span>
        <span className="text-muted-foreground">{tx.date}</span>
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate" title={tx.description}>{tx.description}</span>
          {tagChipsInline}
        </span>
        <span className="text-muted-foreground truncate">{accountName}</span>
        <span className="min-w-0">
          <CategoryBadge
            name={tx.category_name ?? entryTypeLabel(tx.entry_type)}
            color={tx.category_id ? categoryColorById.get(tx.category_id) : undefined}
          />
        </span>
        <span
          className={`text-right whitespace-nowrap ${isPositiveEntryType(tx.entry_type) ? 'text-[color:var(--nl-accent-ink)]' : ''}`}
        >
          {formatMoney(tx.amount)}
        </span>
        <span className="text-right flex items-center justify-end gap-0.5" data-tour="transactions:row-actions">
          {editable && (
            <button
              type="button"
              onClick={() => onEdit(tx)}
              title={t('transactions.actions.edit')}
              className="w-7 h-7 rounded-full flex items-center justify-center text-muted-foreground hover:bg-info/10 hover:text-info"
            >
              <Pencil size={13} />
            </button>
          )}
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleteTransaction.isPending}
            title={t('transactions.actions.delete')}
            className="w-7 h-7 rounded-full flex items-center justify-center text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
          >
            <Trash2 size={13} />
          </button>
        </span>
      </div>

      {/* Card -- mobile only */}
      <div className="lg:hidden flex flex-col gap-1.5 px-3 py-3 text-[13px] border-t border-border">
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-2">
            {selectBox}
            <span className="truncate font-medium">{tx.description}</span>
          </span>
          <span
            className={`flex-shrink-0 ${isPositiveEntryType(tx.entry_type) ? 'text-[color:var(--nl-accent-ink)]' : ''}`}
          >
            {formatMoney(tx.amount)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <CategoryBadge
              name={tx.category_name ?? entryTypeLabel(tx.entry_type)}
              color={tx.category_id ? categoryColorById.get(tx.category_id) : undefined}
            />
            <span className="text-muted-foreground truncate text-[12px]">{accountName}</span>
          </div>
          <span className="text-muted-foreground text-[12px] flex-shrink-0">{tx.date}</span>
        </div>
        {tagChips}
        <div className="self-end flex items-center gap-0.5">
          {editable && (
            <button
              type="button"
              onClick={() => onEdit(tx)}
              title={t('transactions.actions.edit')}
              className="w-7 h-7 rounded-full flex items-center justify-center text-muted-foreground hover:bg-info/10 hover:text-info"
            >
              <Pencil size={13} />
            </button>
          )}
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleteTransaction.isPending}
            title={t('transactions.actions.delete')}
            className="w-7 h-7 rounded-full flex items-center justify-center text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </>
  )
}

function TransactionsHelp() {
  const { t } = useTranslation('pages')
  return (
    <>
      <HelpSection heading={t('transactions.help.overview.heading')}>
        <p>{t('transactions.help.overview.body')}</p>
      </HelpSection>
      <HelpSection heading={t('transactions.help.newTransaction.heading')}>
        <p>{t('transactions.help.newTransaction.body')}</p>
      </HelpSection>
      <HelpSection heading={t('transactions.help.payCard.heading')}>
        <p>{t('transactions.help.payCard.body')}</p>
      </HelpSection>
      <HelpSection heading={t('transactions.help.sharedExpense.heading')}>
        <p>{t('transactions.help.sharedExpense.body1')}</p>
        <DemoFlow
          items={[
            { label: t('transactions.help.sharedExpense.demo.creditCard'), sublabel: '−$500', tone: 'neg' },
            { label: t('transactions.help.sharedExpense.demo.myExpense'), sublabel: '$100', tone: 'warn' },
            { label: t('transactions.help.sharedExpense.demo.owedToMe'), sublabel: '+$400', tone: 'pos' },
          ]}
        />
        <p>{t('transactions.help.sharedExpense.body2')}</p>
      </HelpSection>
      <HelpTip>
        <Trans i18nKey="transactions.help.tip" ns="pages">
          Prestar dinero directo (sin compra de por medio) o que te presten a ti ya no vive aquí — está en{' '}
          <strong>Deudas</strong>, junto con todo lo demás que involucra deber dinero en cualquier
          dirección.
        </Trans>
      </HelpTip>
    </>
  )
}

export function Transactions() {
  const { t } = useTranslation('pages')
  const { data, isLoading, isError } = useAllTransactions()
  const { data: accounts } = useAccounts()
  const { data: allCategories } = useCategories()
  const categoryColorById = new Map((allCategories ?? []).map((c) => [c.id, c.color]))
  const [splitOpen, setSplitOpen] = useState(false)
  const [payOpen, setPayOpen] = useState(false)
  const [payCardId, setPayCardId] = useState<string | null>(null)
  const creditCards = accounts?.filter((a) => a.type === 'liability' && a.subtype === 'credit_card') ?? []
  const payingAccount = creditCards.find((a) => a.id === payCardId) ?? (creditCards.length === 1 ? creditCards[0] : null)
  const [editingTx, setEditingTx] = useState<Transaction | null>(null)
  const openDetailed = useTransactionModalStore((s) => s.openDetailed)
  const [searchParams] = useSearchParams()

  const [search, setSearch] = useState('')
  const [accountFilter, setAccountFilter] = useState(() => searchParams.get('account') ?? 'all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('ALL')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = usePageSize('transactions')
  const { data: allTags = [] } = useTags()
  const bulkTag = useBulkTag()
  const pushToast = useUiStore((s) => s.pushToast)
  const [tagFilter, setTagFilter] = useState(() => searchParams.get('tag') ?? 'all')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkTagIds, setBulkTagIds] = useState<string[]>([])

  const accountName = (id: string) => accounts?.find((a) => a.id === id)?.name ?? '—'
  const txAccountId = (tx: Transaction) => tx.lines[0]?.account_id ?? ''

  const categoryOptions = useMemo(() => {
    const names = new Set((data?.data ?? []).map((tx) => tx.entry_type))
    return Array.from(names)
  }, [data])

  const filtered = (data?.data ?? [])
    .filter((tx) => (search ? tx.description.toLowerCase().includes(search.toLowerCase()) : true))
    .filter((tx) => (accountFilter === 'all' ? true : txAccountId(tx) === accountFilter))
    .filter((tx) => (categoryFilter === 'all' ? true : tx.entry_type === categoryFilter))
    .filter((tx) => (dateFrom ? tx.date >= dateFrom : true))
    .filter((tx) => (dateTo ? tx.date <= dateTo : true))
    .filter((tx) => (typeFilter === 'ALL' ? true : txType(tx) === typeFilter))
    .filter((tx) => (tagFilter === 'all' ? true : tx.tags.some((tag) => tag.id === tagFilter)))
    .sort((a, b) => (sortDir === 'asc' ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date)))

  // Totals of EVERYTHING the filters leave (not just the page on screen), so they always match.
  const totals = summarizeTransactions(filtered)
  const maxPage = Math.max(0, Math.ceil(filtered.length / pageSize) - 1)
  const clampedPage = Math.min(page, maxPage)
  const pageRows = filtered.slice(clampedPage * pageSize, clampedPage * pageSize + pageSize)

  function resetPage() {
    setPage(0)
  }

  // Only expenses can carry tags. Selection survives paging and filtering, but never
  // points at a row that is gone.
  const expenseIds = new Set((data?.data ?? []).filter((tx) => tx.entry_type === 'expense').map((tx) => tx.id))
  const selectedExpenseIds = [...selectedIds].filter((id) => expenseIds.has(id))
  const filteredExpenseIds = filtered.filter((tx) => tx.entry_type === 'expense').map((tx) => tx.id)
  const pageExpenseIds = pageRows.filter((tx) => tx.entry_type === 'expense').map((tx) => tx.id)
  const allPageSelected = pageExpenseIds.length > 0 && pageExpenseIds.every((id) => selectedIds.has(id))

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function togglePage() {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      for (const id of pageExpenseIds) {
        if (allPageSelected) next.delete(id)
        else next.add(id)
      }
      return next
    })
  }

  async function applyBulk(mode: 'add' | 'remove') {
    if (selectedExpenseIds.length === 0 || bulkTagIds.length === 0) return
    try {
      await bulkTag.mutateAsync({
        transaction_ids: selectedExpenseIds,
        ...(mode === 'add' ? { add_tag_ids: bulkTagIds } : { remove_tag_ids: bulkTagIds }),
      })
      pushToast(t(`transactions.tags.${mode}Done`, { count: selectedExpenseIds.length }), 'success')
      setSelectedIds(new Set())
    } catch (error) {
      pushToast(apiErrorMessage(error), 'error')
    }
  }

  const selectedCalendarRange = dateFrom && dateTo ? { from: dateFrom, to: dateTo } : null
  function handleSelectCalendarRange(range: { from: string; to: string } | null) {
    setDateFrom(range?.from ?? '')
    setDateTo(range?.to ?? '')
    resetPage()
  }

  return (
    <div>
      <ViewHeader
        icon={<ArrowLeftRight />}
        title={t('transactions.title')}
        help={<TransactionsHelp />}
        section={HEADER_SECTIONS.diario}
        tourKey="transactions"
        actions={
          <>
            <Dialog open={splitOpen} onOpenChange={setSplitOpen}>
              <DialogTrigger
                render={
                  <button
                    type="button"
                    data-tour="transactions:split-button"
                    className="flex items-center gap-1.5 rounded px-3.5 py-1.5 text-[13px] border border-border text-muted-foreground hover:text-foreground"
                  >
                    <Users size={14} />
                    {t('transactions.sharedExpense')}
                  </button>
                }
              />
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t('transactions.sharedExpense')}</DialogTitle>
                </DialogHeader>
                <SplitExpenseForm onDone={() => setSplitOpen(false)} />
              </DialogContent>
            </Dialog>
            {creditCards.length > 0 && (
              <Dialog
                open={payOpen}
                onOpenChange={(next) => {
                  setPayOpen(next)
                  if (!next) setPayCardId(null)
                }}
              >
                <DialogTrigger
                  render={
                    <button
                      type="button"
                      data-tour="transactions:pay-card-button"
                      className="flex items-center gap-1.5 rounded px-3.5 py-1.5 text-[13px] border border-border text-muted-foreground hover:text-foreground"
                    >
                      <CreditCard size={14} />
                      {t('transactions.payCard.button')}
                    </button>
                  }
                />
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>
                      {payingAccount
                        ? t('transactions.payCard.titleWithName', { name: payingAccount.name })
                        : t('transactions.payCard.title')}
                    </DialogTitle>
                  </DialogHeader>
                  {payingAccount ? (
                    <PayCreditCardForm account={payingAccount} onDone={() => setPayOpen(false)} />
                  ) : (
                    <div className="flex flex-col gap-2">
                      <p className="text-sm text-muted-foreground">{t('transactions.payCard.choose')}</p>
                      {creditCards.map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => setPayCardId(a.id)}
                          className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-[13px] hover:bg-muted"
                        >
                          <span>{a.name}</span>
                          <span className="text-muted-foreground">{formatMoney(a.balance)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </DialogContent>
              </Dialog>
            )}
            <button
              type="button"
              onClick={() => openDetailed()}
              data-tour="transactions:new-button"
              className="flex items-center gap-1.5 rounded px-3.5 py-1.5 text-[13px] font-medium"
              style={{ background: 'var(--nl-accent)', color: 'var(--nl-accent-fg)' }}
            >
              <Plus size={14} />
              {t('transactions.newTransactionButton')}
            </button>
          </>
        }
      />

      <div className="flex flex-col lg:flex-row gap-4 items-start">
        <div className="flex-1 min-w-0 w-full">
          <div
            className="bg-card border border-border rounded-md p-3.5 mb-4 flex gap-2.5 flex-wrap items-center"
            data-tour="transactions:filters"
          >
            <input
              placeholder={t('transactions.filters.search')}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                resetPage()
              }}
              className={`${selectClass} h-9 flex-1 min-w-[180px]`}
            />
            <Select
              value={accountFilter}
              onValueChange={(v) => {
                setAccountFilter(v ?? 'all')
                resetPage()
              }}
            >
              <SelectTrigger className="h-9 w-auto">
                <SelectValue>
                  {(v: string) =>
                    v === 'all' ? t('transactions.filters.allAccounts') : accounts?.find((a) => a.id === v)?.name
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('transactions.filters.allAccounts')}</SelectItem>
                {accounts?.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={categoryFilter}
              onValueChange={(v) => {
                setCategoryFilter(v ?? 'all')
                resetPage()
              }}
            >
              <SelectTrigger className="h-9 w-auto">
                <SelectValue>
                  {(v: string) => (v === 'all' ? t('transactions.filters.allTypes') : entryTypeLabel(v))}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('transactions.filters.allTypes')}</SelectItem>
                {categoryOptions.map((c) => (
                  <SelectItem key={c} value={c}>
                    {entryTypeLabel(c)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {allTags.length > 0 && (
              <Select
                value={tagFilter}
                onValueChange={(v) => {
                  setTagFilter(v ?? 'all')
                  resetPage()
                }}
              >
                <SelectTrigger className="h-9 w-auto" data-tour="transactions:tag-filter">
                  <SelectValue>
                    {(v: string) =>
                      v === 'all' ? t('transactions.tags.filterAll') : (allTags.find((tag) => tag.id === v)?.name ?? v)
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('transactions.tags.filterAll')}</SelectItem>
                  {allTags.map((tag) => (
                    <SelectItem key={tag.id} value={tag.id}>
                      {tag.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value)
                resetPage()
              }}
              className={`${selectClass} h-9`}
            />
            <input
              type="date"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value)
                resetPage()
              }}
              className={`${selectClass} h-9`}
            />
            {/* Second row of the filters: the type selector on one side and, on the opposite side,
                the totals of everything the filters leave (not just the page on screen). The type
                filter decides which figures show: all for TODO, only the matching ones otherwise.
                Hidden while nothing matches. */}
            <div className="flex w-full flex-wrap items-center justify-between gap-x-6 gap-y-2">
              <SegmentedControl
                value={typeFilter}
                onChange={(v: TypeFilter) => {
                  setTypeFilter(v)
                  resetPage()
                }}
                options={[
                  { value: 'ALL', label: t('transactions.filters.type.all') },
                  { value: 'INCOME', label: t('transactions.filters.type.income') },
                  { value: 'EXPENSE', label: t('transactions.filters.type.expense') },
                  { value: 'TRANSFER', label: t('transactions.filters.type.transfer') },
                ]}
              />
              {filtered.length > 0 && (
                <dl className="flex flex-wrap items-baseline justify-end gap-x-5 gap-y-1 text-[12px]" data-testid="transaction-totals">
                  {(typeFilter === 'ALL' || typeFilter === 'INCOME') && (
                    <TotalChip
                      label={t('transactions.totals.income')}
                      value={formatMoneyBase(totals.income.total)}
                      count={totals.income.count}
                      tone="income"
                    />
                  )}
                  {(typeFilter === 'ALL' || typeFilter === 'EXPENSE') && (
                    <TotalChip
                      label={t('transactions.totals.expenses')}
                      value={formatMoneyBase(totals.expense.total)}
                      count={totals.expense.count}
                      tone="expense"
                    />
                  )}
                  {typeFilter === 'ALL' && (
                    <TotalChip
                      label={t('transactions.totals.net')}
                      value={formatMoneyBase(totals.net)}
                      tone={totals.net > 0 ? 'positive' : totals.net < 0 ? 'negative' : 'neutral'}
                    />
                  )}
                  {((typeFilter === 'ALL' && totals.transfer.count > 0) || typeFilter === 'TRANSFER') && (
                    <TotalChip
                      label={t('transactions.totals.transfers')}
                      value={formatMoneyBase(totals.transfer.total)}
                      count={totals.transfer.count}
                    />
                  )}
                  {typeFilter === 'INCOME' && totals.income.count > 0 && (
                    <TotalChip
                      label={t('transactions.totals.averageIncome')}
                      value={formatMoneyBase(totals.income.total / totals.income.count)}
                      tone="income"
                    />
                  )}
                  {typeFilter === 'EXPENSE' && totals.expense.count > 0 && (
                    <TotalChip
                      label={t('transactions.totals.averageExpense')}
                      value={formatMoneyBase(totals.expense.total / totals.expense.count)}
                      tone="expense"
                    />
                  )}
                </dl>
              )}
            </div>
          </div>

          {selectedExpenseIds.length > 0 && (
            <div
              className="bg-card border border-border rounded-md p-3.5 mb-4 flex flex-col gap-3"
              data-tour="transactions:bulk-tags"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
                <span className="font-medium">
                  {t('transactions.tags.selected', { count: selectedExpenseIds.length })}
                </span>
                <span className="flex items-center gap-3 text-xs">
                  {selectedExpenseIds.length < filteredExpenseIds.length && (
                    <button
                      type="button"
                      onClick={() => setSelectedIds(new Set(filteredExpenseIds))}
                      className="text-[color:var(--nl-accent-ink)] hover:underline"
                    >
                      {t('transactions.tags.selectFiltered', { count: filteredExpenseIds.length })}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setSelectedIds(new Set())}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    {t('transactions.tags.clearSelection')}
                  </button>
                </span>
              </div>
              <TagPicker value={bulkTagIds} onChange={setBulkTagIds} />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void applyBulk('add')}
                  disabled={bulkTagIds.length === 0 || bulkTag.isPending}
                  className="rounded-md px-3 py-1.5 text-[12.5px] font-semibold disabled:opacity-40"
                  style={{ background: 'var(--nl-accent)', color: 'var(--nl-accent-fg)' }}
                >
                  {t('transactions.tags.add')}
                </button>
                <button
                  type="button"
                  onClick={() => void applyBulk('remove')}
                  disabled={bulkTagIds.length === 0 || bulkTag.isPending}
                  className="rounded-md border border-border px-3 py-1.5 text-[12.5px] text-muted-foreground hover:text-foreground disabled:opacity-40"
                >
                  {t('transactions.tags.remove')}
                </button>
              </div>
            </div>
          )}

          <div className="bg-card border border-border rounded-md overflow-hidden">
            <div className={`hidden lg:grid ${TRANSACTION_COLUMNS} gap-2 px-3 py-2 text-[11px] uppercase tracking-wide text-muted-foreground`}>
              <span>
                {pageExpenseIds.length > 0 && (
                  <input
                    type="checkbox"
                    checked={allPageSelected}
                    onChange={togglePage}
                    aria-label={t('transactions.tags.selectPage')}
                    className="h-3.5 w-3.5 cursor-pointer accent-[var(--nl-accent)]"
                  />
                )}
              </span>
              <button
                type="button"
                onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
                data-tour="transactions:sort"
                className="text-left hover:text-foreground"
              >
                {t('transactions.fields.date')} {sortDir === 'asc' ? '▲' : '▼'}
              </button>
              <span>{t('transactions.fields.description')}</span>
              <span>{t('transactions.fields.account')}</span>
              <span>{t('transactions.fields.category')}</span>
              <span className="text-right">{t('transactions.fields.amount')}</span>
              <span className="text-right">{t('transactions.fields.actions')}</span>
            </div>
            {isLoading ? (
              <p className="text-sm text-muted-foreground p-6">{t('transactions.states.loading')}</p>
            ) : isError ? (
              <p className="text-sm text-destructive p-6">{t('transactions.states.error')}</p>
            ) : pageRows.length === 0 ? (
              <p className="text-center text-[12px] text-muted-foreground py-7">
                {t('transactions.states.empty')}
              </p>
            ) : (
              pageRows.map((tx) => (
                <TransactionRow
                  key={tx.id}
                  tx={tx}
                  accountName={accountName(txAccountId(tx))}
                  categoryColorById={categoryColorById}
                  onEdit={setEditingTx}
                  selected={selectedIds.has(tx.id)}
                  onToggleSelected={tx.entry_type === 'expense' ? toggleSelected : undefined}
                />
              ))
            )}
          </div>

          <div className="flex justify-between items-center mt-3.5 text-xs text-muted-foreground">
            <span>
              {t('transactions.pagination', {
                from: filtered.length === 0 ? 0 : clampedPage * pageSize + 1,
                to: Math.min(filtered.length, clampedPage * pageSize + pageSize),
                total: filtered.length,
              })}
            </span>
            <div className="flex items-center gap-3">
              <PageSizeSelect
                value={pageSize}
                onChange={(size) => {
                  setPageSize(size)
                  resetPage()
                }}
              />
              <button
                type="button"
                disabled={clampedPage === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                className="flex items-center gap-1 rounded px-3 py-1.5 border border-border disabled:opacity-40"
              >
                <ChevronLeft size={13} />
                {t('transactions.paginationPrev')}
              </button>
              <button
                type="button"
                disabled={clampedPage >= maxPage}
                onClick={() => setPage((p) => Math.min(maxPage, p + 1))}
                className="flex items-center gap-1 rounded px-3 py-1.5 border border-border disabled:opacity-40"
              >
                {t('transactions.paginationNext')}
                <ChevronRight size={13} />
              </button>
            </div>
          </div>
        </div>

        <div
          className="w-full lg:w-[260px] flex-shrink-0 bg-card border border-border rounded-md p-3"
          data-tour="transactions:calendar"
        >
          <TransactionsCalendar selectedRange={selectedCalendarRange} onSelectRange={handleSelectCalendarRange} />
        </div>
      </div>

      <EditTransactionModal transaction={editingTx} onClose={() => setEditingTx(null)} />
    </div>
  )
}
