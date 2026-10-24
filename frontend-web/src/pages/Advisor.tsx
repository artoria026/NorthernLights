import {
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  Paperclip,
  Plus,
  RotateCcw,
  Send,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react'
import { type ChangeEvent, type ClipboardEvent, type DragEvent, type FormEvent, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Link } from 'react-router-dom'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AttachmentTray } from '@/components/nl/AttachmentTray'
import { HelpSection, HelpTip } from '@/components/nl/Help'
import { HEADER_SECTIONS, ViewHeader } from '@/components/nl/primitives'
import { ProposalCard } from '@/components/nl/ProposalCard'
import { useAiHistory, useAiUsage, useChatStream, useClearAiHistory } from '@/hooks/useAiChat'
import { useAttachments } from '@/hooks/useAttachments'
import { useResolveProposal } from '@/hooks/useProposals'
import { useFinancialSnapshot } from '@/hooks/useEngine'
import { useTransactions } from '@/hooks/useTransactions'
import { useCategories } from '@/hooks/useCategories'
import { ACCEPT_ATTACHMENTS } from '@/lib/attachments'
import { getExportPrompt } from '@/lib/importPrompt'
import { amountColor, formatMoney, isPositiveEntryType } from '@/lib/utils'
import { apiErrorMessage } from '@/services/api'
import { useUiStore } from '@/stores/uiStore'
import type { ProposalCallResult, ProposalStatus } from '@/types'

/** Same thresholds already used by health_score in other screens: 70+ is
 * healthy (green), 40-69 fair (orange), under 40 poor (red). */
function healthScoreColors(score: number): { bg: string; ink: string } {
  if (score >= 70) return { bg: 'var(--nl-accent-soft-bg)', ink: 'var(--nl-accent-ink)' }
  if (score >= 40) return { bg: 'var(--nl-warning-soft-bg)', ink: 'var(--nl-warning-ink)' }
  return { bg: 'var(--nl-danger-soft-bg)', ink: 'var(--nl-danger-ink)' }
}

/** Runway = how many months your liquidity would last if you stopped
 * receiving income -- less than 1 month is a real risk signal, not a
 * neutral data point. */
function runwayColor(months: number): string | undefined {
  if (months < 1) return 'var(--nl-danger-ink)'
  if (months < 3) return 'var(--nl-warning-ink)'
  return 'var(--nl-accent-ink)'
}

const MARKDOWN_COMPONENTS = {
  p: ({ ...props }) => <p className="mb-2 last:mb-0 leading-relaxed" {...props} />,
  ul: ({ ...props }) => <ul className="mb-2 last:mb-0 pl-4 list-disc space-y-0.5" {...props} />,
  ol: ({ ...props }) => <ol className="mb-2 last:mb-0 pl-4 list-decimal space-y-0.5" {...props} />,
  li: ({ ...props }) => <li {...props} />,
  h1: ({ ...props }) => (
    <h1
      className="text-[15px] font-semibold mt-3 mb-1.5 first:mt-0"
      style={{ color: 'var(--nl-accent-ink)' }}
      {...props}
    />
  ),
  h2: ({ ...props }) => (
    <h2
      className="text-[14px] font-semibold mt-3 mb-1.5 first:mt-0"
      style={{ color: 'var(--nl-accent-ink)' }}
      {...props}
    />
  ),
  h3: ({ ...props }) => <h3 className="text-sm font-semibold mt-2.5 mb-1 first:mt-0" {...props} />,
  em: ({ ...props }) => <em {...props} />,
  a: ({ ...props }) => (
    <a className="underline hover:no-underline" style={{ color: 'var(--nl-accent-ink)' }} {...props} />
  ),
  strong: ({ ...props }) => <strong className="font-semibold" {...props} />,
  hr: () => <hr className="my-3 border-border" />,
  code: ({ ...props }) => (
    <code className="rounded px-1 py-0.5 text-[12px]" style={{ background: 'var(--nl-bg-track)' }} {...props} />
  ),
  table: ({ ...props }) => (
    <div className="overflow-x-auto mb-2">
      <table className="text-[12.5px] border-collapse" {...props} />
    </div>
  ),
  th: ({ ...props }) => <th className="border border-border px-2 py-1 text-left" {...props} />,
  td: ({ ...props }) => <td className="border border-border px-2 py-1" {...props} />,
}

/** The proposals an assistant message carries: the `propose_actions` calls the server
 * stored (backend/app/services/proposal_service.py). The advisor registers nothing by
 * itself -- each proposal is a card the user confirms or cancels. A call the advisor had
 * to retry after a validation error has no `proposal_id` and isn't shown. */
function findProposals(toolCalls: { tool: string; result: unknown }[] | undefined): ProposalCallResult[] {
  return (toolCalls ?? [])
    .filter((call) => call.tool === 'propose_actions')
    .map((call) => call.result as ProposalCallResult)
    .filter((result) => !!result?.proposal_id)
}

/** thinkBounce already existed in index.css (probably for this exact
 * purpose) but had never been used -- 3 dots with staggered
 * animation-delay, same visual pattern as the "Conectado" dot (pulseDot)
 * in the header. */
function TypingIndicator() {
  const { t } = useTranslation('pages')
  return (
    <div className="flex items-center gap-1 py-1" aria-label={t('advisor.typingLabel')}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-1.5 h-1.5 rounded-full"
          style={{
            background: 'var(--nl-accent)',
            animation: 'thinkBounce 1.4s ease-in-out infinite',
            animationDelay: `${i * 0.16}s`,
          }}
        />
      ))}
    </div>
  )
}

function buildSuggestions(t: (key: string) => string): string[] {
  return [
    t('advisor.suggestions.budget'),
    t('advisor.suggestions.debtPriority'),
    t('advisor.suggestions.savings'),
    t('advisor.suggestions.summary'),
    t('advisor.suggestions.logExpense'),
  ]
}

function AdvisorHelp() {
  const { t } = useTranslation('pages')
  return (
    <>
      <HelpSection heading={t('advisor.help.whatIsThisScreen.heading')}>
        <p>{t('advisor.help.whatIsThisScreen.body')}</p>
      </HelpSection>
      <HelpSection heading={t('advisor.help.suggestions.heading')}>
        <p>{t('advisor.help.suggestions.body')}</p>
      </HelpSection>
      <HelpSection heading={t('advisor.help.clearHistory.heading')}>
        <p>{t('advisor.help.clearHistory.body')}</p>
      </HelpSection>
      <HelpSection heading={t('advisor.help.remainingQueriesToday.heading')}>
        <p>{t('advisor.help.remainingQueriesToday.body')}</p>
      </HelpSection>
      <HelpSection heading={t('advisor.help.historicalData.heading')}>
        <p>{t('advisor.help.historicalData.body')}</p>
      </HelpSection>
      <HelpTip>{t('advisor.help.tip')}</HelpTip>
    </>
  )
}

export function Advisor() {
  const { t } = useTranslation('pages')
  const { data: snapshot } = useFinancialSnapshot()
  const { data: history } = useAiHistory(1, 20)
  const { data: recentTx } = useTransactions({ per_page: 5 })
  const { data: usage } = useAiUsage()
  const { data: categories } = useCategories()
  const topLevelCategoryNames = (categories ?? []).filter((c) => c.parent_id === null).map((c) => c.name)
  const clearHistory = useClearAiHistory()
  const { messages, setMessages, sendMessage, isStreaming, error, canRetry, retryLast, savedInsight } =
    useChatStream()
  const [input, setInput] = useState('')
  const attachments = useAttachments()
  const pushToast = useUiStore((s) => s.pushToast)
  const resolveProposal = useResolveProposal()
  // What the server answered when a proposal was confirmed/cancelled on this screen: it
  // wins over the status the message was loaded with (which was pending).
  const [proposalOverrides, setProposalOverrides] = useState<
    Record<string, { status: ProposalStatus; error: string | null }>
  >({})
  const [busyProposal, setBusyProposal] = useState<{ id: string; action: 'confirm' | 'cancel' } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const seeded = useRef(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // If the user scrolled up to reread the history, a new message (especially
  // one arriving via streaming) shouldn't yank them back down -- that's what
  // the old unconditional auto-scroll did. We only keep following the
  // automatic scroll if it was already pinned to the bottom, or if the new
  // message is from the user themselves (whoever types always expects to see
  // what they just sent). Otherwise, the "new message" notice lights up.
  const isNearBottomRef = useRef(true)
  const [showJumpButton, setShowJumpButton] = useState(false)
  const suggestions = buildSuggestions(t)

  useEffect(() => {
    if (seeded.current || !history || messages.length > 0) return
    seeded.current = true
    setMessages(
      [...history.items]
        .reverse()
        .map((m) => ({ role: m.role, content: m.content, toolCalls: m.tool_calls ?? undefined })),
    )
  }, [history, messages.length, setMessages])

  function scrollToBottom() {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    setShowJumpButton(false)
  }

  function handleMessagesScroll() {
    const el = scrollRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    isNearBottomRef.current = nearBottom
    if (nearBottom) setShowJumpButton(false)
  }

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const lastRole = messages.at(-1)?.role
    if (lastRole === 'user' || isNearBottomRef.current) {
      el.scrollTo({ top: el.scrollHeight })
      isNearBottomRef.current = true
      setShowJumpButton(false)
    } else {
      setShowJumpButton(true)
    }
  }, [messages])

  /** Screenshots and PDFs from the file picker, a paste (Ctrl+V of a screenshot) or a drop:
   * each is classified by its content; the ones that can't go say why. */
  async function addFiles(files: File[]) {
    if (files.length === 0) return
    const rejected = await attachments.addFiles(files)
    for (const file of rejected) {
      pushToast(t(`advisor.attachErrors.${file.reason}`, { name: file.name }), 'error')
    }
  }

  function handleFilePick(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    void addFiles(files)
  }

  function handlePaste(event: ClipboardEvent<HTMLInputElement>) {
    const files = Array.from(event.clipboardData.files)
    if (files.length === 0) return // plain text: let the browser paste it
    event.preventDefault()
    void addFiles(files)
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    if (!isStreaming) setDragging(true)
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false)
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)
    if (!isStreaming) void addFiles(Array.from(event.dataTransfer.files))
  }

  async function handleProposal(id: string, action: 'confirm' | 'cancel') {
    setBusyProposal({ id, action })
    try {
      const proposal = await resolveProposal.mutateAsync({ id, action })
      setProposalOverrides((prev) => ({ ...prev, [id]: { status: proposal.status, error: proposal.error } }))
    } catch (err) {
      pushToast(apiErrorMessage(err), 'error')
    } finally {
      setBusyProposal(null)
    }
  }

  async function copyPrompt() {
    await navigator.clipboard.writeText(getExportPrompt(topLevelCategoryNames))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function send(text: string) {
    const message = text.trim()
    const hasAttachments = attachments.items.length > 0
    if ((!message && !hasAttachments) || isStreaming) return
    // An encrypted PDF still waiting for its password would just be refused.
    if (attachments.processing || attachments.missingPassword) return
    // The text shown in the bubble and the one actually sent to the backend
    // are no longer the same string -- useAiChat appends "(adjunto: ...)" to
    // THAT one so the server-side history keeps the context, but here on
    // screen the file name shows as a chip, not as text stuck to the
    // message.
    if (!hasAttachments) {
      setInput('')
      await sendMessage(message)
      return
    }
    const { files, passwords } = attachments.payload()
    const previews = attachments.items.flatMap((item) => (item.previewUrl ? [item.previewUrl] : []))
    // The text and the files stay in the box until the server accepts them: if it
    // refuses one (say, a wrong password) nothing is lost and that file gets flagged.
    const result = await sendMessage(
      message,
      { files, passwords },
      {
        previews,
        onAccepted: () => {
          setInput('')
          attachments.clear()
        },
      },
    )
    if (!result.ok && result.attachmentProblem) {
      const { code, index } = result.attachmentProblem
      if ((code === 'PDF_PASSWORD_REQUIRED' || code === 'PDF_PASSWORD_INVALID') && index !== undefined) {
        attachments.flagPasswordProblem(index)
      }
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    void send(input)
  }

  function handleClear() {
    seeded.current = true
    setMessages([])
    clearHistory.mutate()
  }

  return (
    // No longer bleeds through the Layout's padding (see Layout.tsx: <main>
    // is flex-col, this uses lg:flex-1 lg:min-h-0 to fill the available
    // height without a hand-rolled calc(100vh-Npx)) -- the whole column,
    // header included, ends up with the same gutter as any other screen.
    <div className="flex flex-col lg:flex-1 lg:min-h-0">
      <ViewHeader
        icon={<Bot />}
        title={t('advisor.title')}
        help={<AdvisorHelp />}
        section={HEADER_SECTIONS.inteligencia}
        tourKey="advisor"
        actions={
          <>
            <span
              className="hidden lg:flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium"
              style={{ background: 'var(--nl-accent-soft-bg)', color: 'var(--nl-accent-ink)' }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{ background: 'var(--nl-accent-ink)', animation: 'pulseDot 1.6s ease-in-out infinite' }}
              />
              {t('advisor.header.connected')}
            </span>
            {usage && usage.unlimited && (
              <span
                data-tour="advisor:usage"
                className="rounded-full px-3 py-1.5 text-xs font-medium whitespace-nowrap"
                style={{ background: 'var(--nl-accent-soft-bg)', color: 'var(--nl-accent-ink)' }}
                title={t('advisor.header.unlimitedTitle')}
              >
                {t('advisor.header.unlimited')}
              </span>
            )}
            {usage && !usage.unlimited && (
              <span
                data-tour="advisor:usage"
                className="rounded-full px-3 py-1.5 text-xs font-medium whitespace-nowrap"
                style={{
                  background: usage.remaining_today <= 5 ? 'var(--nl-warning-soft-bg)' : 'var(--nl-bg-input)',
                  color: usage.remaining_today <= 5 ? 'var(--nl-warning-ink)' : 'var(--nl-text-secondary)',
                }}
                title={t('advisor.header.usageTitle', { used: usage.used_today, limit: usage.limit_per_day })}
              >
                {t('advisor.header.usageToday', { remaining: usage.remaining_today, limit: usage.limit_per_day })}
              </span>
            )}
            <span
              className="hidden lg:flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium"
              style={{ background: 'var(--nl-bg-input)', color: 'var(--nl-text-secondary)' }}
            >
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: 'var(--nl-violet)' }} />
              gemini-flash-latest
            </span>
            <button
              type="button"
              title={t('advisor.header.clearHistoryTitle')}
              onClick={handleClear}
              className="rounded-full p-2 text-muted-foreground hover:text-destructive hover:bg-muted transition-colors"
            >
              <Trash2 size={15} />
            </button>
          </>
        }
      />

      <div className="flex flex-col lg:flex-row lg:flex-1 lg:min-h-0">
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className="relative flex flex-col h-[65vh] lg:h-auto lg:min-h-0 lg:flex-[0_0_60%] min-w-0"
        >
          {dragging && (
            <div
              className="absolute inset-2 z-20 flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed text-sm pointer-events-none"
              style={{ background: 'var(--nl-violet-soft-bg)', color: 'var(--nl-violet-ink)', borderColor: 'var(--nl-violet)' }}
            >
              <Upload size={22} />
              {t('advisor.attachments.dropHere')}
            </div>
          )}
          <div
            ref={scrollRef}
            onScroll={handleMessagesScroll}
            className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 lg:px-8 py-6 flex flex-col gap-4"
          >
            {messages.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center">
                <Sparkles size={32} className="text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground max-w-xs">{t('advisor.emptyState')}</p>
              </div>
            ) : (
              messages.map((message, i) => {
                const isLast = i === messages.length - 1
                const proposals = message.role === 'assistant' ? findProposals(message.toolCalls) : []
                if (!message.content && proposals.length === 0 && !(isStreaming && isLast)) return null
                if (message.role === 'user') {
                  return (
                    <div
                      key={i}
                      className="self-end max-w-[70%] flex flex-col items-end gap-1.5 rounded-[14px] rounded-br-sm px-3.5 py-3 text-sm"
                      style={{ background: 'var(--nl-violet-soft-bg)', color: 'var(--nl-violet-ink)' }}
                    >
                      {message.content}
                      {message.attachmentPreviews && message.attachmentPreviews.length > 0 && (
                        <div className="flex flex-wrap justify-end gap-1.5">
                          {message.attachmentPreviews.map((url) => (
                            <img
                              key={url}
                              src={url}
                              alt=""
                              className="h-16 w-16 rounded-md object-cover border border-border"
                            />
                          ))}
                        </div>
                      )}
                      {message.attachmentNames && message.attachmentNames.length > 0 && (
                        <div className="flex flex-wrap justify-end gap-1.5">
                          {message.attachmentNames.map((name, fi) => (
                            <span
                              key={fi}
                              className="flex items-center gap-1 rounded-full px-2 py-1 text-[11px]"
                              style={{ background: 'var(--nl-bg-card)', color: 'var(--nl-text-secondary)' }}
                            >
                              <Paperclip size={11} className="flex-shrink-0" />
                              <span className="truncate max-w-[140px]">{name}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                }
                const avatar = (
                  <span
                    className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ background: 'var(--nl-accent-soft-bg)' }}
                  >
                    <Sparkles size={12} style={{ color: 'var(--nl-accent-ink)' }} />
                  </span>
                )
                // The advisor proposes (it never registers by itself): a card per proposal
                // with real Confirm/Cancel buttons. What it shows is what the server stored,
                // and confirming runs exactly that. A pending proposal can be answered at any
                // time (the server is the authority), not only while it is the last message.
                if (proposals.length > 0) {
                  return (
                    <div key={i} className="self-start max-w-[92%] lg:max-w-[84%] flex gap-3">
                      {avatar}
                      <div className="flex-1 min-w-0 flex flex-col gap-2">
                        {message.content && (
                          <div className="rounded-[10px] rounded-tl-sm px-4.5 py-4 text-sm bg-card">
                            <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
                              {message.content}
                            </ReactMarkdown>
                          </div>
                        )}
                        {proposals.map((proposal) => {
                          const resolved = proposalOverrides[proposal.proposal_id]
                          return (
                            <ProposalCard
                              key={proposal.proposal_id}
                              summary={proposal.summary}
                              items={proposal.items}
                              status={resolved?.status ?? proposal.status}
                              error={resolved ? resolved.error : proposal.error}
                              busy={busyProposal?.id === proposal.proposal_id ? busyProposal.action : null}
                              onConfirm={() => void handleProposal(proposal.proposal_id, 'confirm')}
                              onCancel={() => void handleProposal(proposal.proposal_id, 'cancel')}
                            />
                          )
                        })}
                      </div>
                    </div>
                  )
                }
                return (
                  <div
                    key={i}
                    className="self-start max-w-[78%] rounded-[10px] rounded-tl-sm px-4.5 py-4 text-sm bg-card flex gap-3"
                  >
                    {avatar}
                    <div className="flex-1 min-w-0">
                      {message.content ? (
                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
                          {message.content}
                        </ReactMarkdown>
                      ) : isStreaming && isLast ? (
                        <TypingIndicator />
                      ) : null}
                    </div>
                  </div>
                )
              })
            )}
            {savedInsight && (
              <div
                className="self-start flex items-center gap-2 rounded-md px-3 py-2 text-xs"
                style={{ background: 'var(--nl-accent-soft-bg)', color: 'var(--nl-accent-ink)' }}
              >
                <CheckCircle2 size={14} className="flex-shrink-0" />
                <span>{t('advisor.insightSaved', { title: savedInsight.title })}</span>
                <Link to="/insights" className="underline hover:no-underline">
                  {t('advisor.viewIt')}
                </Link>
              </div>
            )}
            {error && (
              <div className="self-start flex items-center gap-2">
                <p className="text-sm text-destructive">{error}</p>
                {canRetry && (
                  <button
                    type="button"
                    onClick={retryLast}
                    className="flex items-center gap-1 rounded px-2 py-1 text-xs border border-border text-muted-foreground hover:text-foreground flex-shrink-0"
                  >
                    <RotateCcw size={12} />
                    {t('advisor.retryButton')}
                  </button>
                )}
              </div>
            )}
          </div>

          {showJumpButton && (
            <button
              type="button"
              onClick={scrollToBottom}
              className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium shadow-md"
              style={{ background: 'var(--nl-accent)', color: 'var(--nl-accent-fg)' }}
            >
              <ChevronDown size={13} />
              {t('advisor.newMessageButton')}
            </button>
          )}

          <form onSubmit={handleSubmit} className="flex-shrink-0 border-t border-border px-4 lg:px-8 py-4 lg:py-5">
            <AttachmentTray
              items={attachments.items}
              disabled={isStreaming}
              onRemove={attachments.remove}
              onPassword={attachments.setPassword}
            />
            <div className="flex items-center gap-2 mb-3">
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPT_ATTACHMENTS}
                multiple
                onChange={handleFilePick}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isStreaming}
                title={t('advisor.attachTitle')}
                data-tour="advisor:attach"
                className="flex-shrink-0 w-11 h-11 rounded-md border border-border flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-40"
              >
                <Paperclip size={16} />
              </button>
              <button
                type="button"
                onClick={() => setMoreOpen(true)}
                disabled={isStreaming}
                title={t('advisor.moreOptionsTitle')}
                data-tour="advisor:more"
                className="flex-shrink-0 w-11 h-11 rounded-md border border-border flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-40"
              >
                <Plus size={16} />
              </button>
              <div className="relative flex-1" data-tour="advisor:input">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onPaste={handlePaste}
                  disabled={isStreaming}
                  placeholder={
                    attachments.items.length > 0
                      ? t('advisor.inputPlaceholderWithAttachment')
                      : t('advisor.inputPlaceholder')
                  }
                  className="w-full h-11 rounded-md border border-border pl-4 pr-11 text-sm outline-none focus:border-ring disabled:text-muted-foreground"
                  style={{ background: 'var(--nl-bg-input)' }}
                />
                <button
                  type="submit"
                  disabled={
                    isStreaming ||
                    attachments.processing ||
                    attachments.missingPassword ||
                    (!input.trim() && attachments.items.length === 0)
                  }
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-md flex items-center justify-center disabled:opacity-40"
                  style={{ background: 'var(--nl-accent)', color: 'var(--nl-accent-fg)' }}
                >
                  <Send size={14} />
                </button>
              </div>
            </div>
            {/* Only before the first message -- once the conversation
                starts, these 5 suggestions no longer add value (the user
                is typing what they need) and only take up useful height
                from the history. */}
            {messages.length === 0 && (
              <div className="flex gap-2 flex-wrap" data-tour="advisor:suggestions">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={isStreaming}
                    onClick={() => void send(s)}
                    className="rounded-full px-3 py-1.5 text-xs border border-border text-muted-foreground hover:text-foreground disabled:opacity-40"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </form>
        </div>

        {/* Deliberately WITHOUT overflow-y-auto -- this panel never scrolls,
            it stays fixed while the chat (on the left) is the only thing
            that moves. Its content is finite (summary + up to 5
            transactions), so it doesn't need its own scroll --
            overflow-hidden is just a safeguard in case it ever grows more
            than expected, so in that case it gets clipped instead of
            pushing the page again. */}
        <div
          className="border-t lg:border-t-0 lg:border-l border-border overflow-hidden p-4 lg:p-5 lg:flex-[0_0_40%]"
          style={{ background: 'var(--sidebar)' }}
          data-tour="advisor:context"
        >
          <div className="text-[11px] tracking-wide text-muted-foreground font-semibold mb-2">
            {t('advisor.sidebar.financialSummary')}
          </div>
          <div className="text-[26px] font-light mb-1" style={{ color: amountColor(snapshot?.net_worth.net_worth) }}>
            {formatMoney(snapshot?.net_worth.net_worth)}
          </div>
          <div className="text-xs text-muted-foreground mb-3">{t('advisor.sidebar.netWorth')}</div>

          <div className="flex flex-col mb-4">
            <div className="flex justify-between items-center py-2 border-t border-border text-[13px]">
              <span className="text-muted-foreground">{t('advisor.sidebar.financialHealth')}</span>
              <span
                className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                style={
                  snapshot
                    ? {
                        background: healthScoreColors(snapshot.health_score.score).bg,
                        color: healthScoreColors(snapshot.health_score.score).ink,
                      }
                    : undefined
                }
              >
                {snapshot ? `${snapshot.health_score.score}/100` : '—'}
              </span>
            </div>
            <div className="flex justify-between items-center py-2 border-t border-border text-[13px]">
              <span className="text-muted-foreground">{t('advisor.sidebar.committedMonthly')}</span>
              <span>{formatMoney(snapshot?.committed_monthly)}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-t border-border text-[13px]">
              <span className="text-muted-foreground">{t('advisor.sidebar.availableThisWeek')}</span>
              <span style={{ color: amountColor(snapshot?.available_this_week.available) }}>
                {formatMoney(snapshot?.available_this_week.available)}
              </span>
            </div>
            <div className="flex justify-between items-center py-2 border-t border-border text-[13px]">
              <span className="text-muted-foreground">{t('advisor.sidebar.runway')}</span>
              <span style={{ color: snapshot ? runwayColor(snapshot.runway.months) : undefined }}>
                {snapshot?.runway.label ?? '—'}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] tracking-wide text-muted-foreground font-semibold">
              {t('advisor.sidebar.recentTransactions')}
            </span>
            <Link to="/transactions" className="text-[11px] text-muted-foreground hover:text-foreground">
              {t('advisor.sidebar.viewAll')}
            </Link>
          </div>
          <div className="flex flex-col">
            {(recentTx?.data ?? []).map((tx) => {
              const positive = isPositiveEntryType(tx.entry_type)
              const color = positive ? 'var(--nl-accent-ink)' : 'var(--nl-danger-ink)'
              return (
                <div key={tx.id} className="flex items-center gap-2 py-1.5 border-t border-border first:border-0">
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: color }} />
                  <span className="flex-1 text-[12px] truncate">{tx.description}</span>
                  <span className="text-[12px]" style={{ color }}>
                    {positive ? '+' : '−'}
                    {formatMoney(tx.amount ?? '0')}
                  </span>
                </div>
              )
            })}
          </div>

          <p className="text-[11px] text-muted-foreground italic mt-4">{t('advisor.sidebar.disclaimer')}</p>
        </div>
      </div>

      <Dialog open={moreOpen} onOpenChange={setMoreOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('advisor.dialog.title')}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-5">
            <div>
              <div className="text-[15px] font-semibold mb-1">{t('advisor.dialog.promptHeading')}</div>
              <p className="text-sm text-muted-foreground mb-3">{t('advisor.dialog.promptDescription')}</p>
              <button
                type="button"
                onClick={copyPrompt}
                className="w-full flex items-center justify-center gap-1.5 rounded-md border border-border py-2 text-sm hover:bg-muted"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? t('advisor.dialog.copiedButton') : t('advisor.dialog.copyButton')}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
