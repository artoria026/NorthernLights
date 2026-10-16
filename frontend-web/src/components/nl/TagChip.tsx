/** A tag as a small label: a dot in the tag's own color and its name. */
export function TagChip({
  name,
  color,
  compact,
  onRemove,
  removeLabel,
}: {
  name: string
  color: string
  /** Smaller, with a capped width: for rows of a list, where it must not make the row taller. */
  compact?: boolean
  onRemove?: () => void
  removeLabel?: string
}) {
  return (
    <span
      title={name}
      className={`inline-flex max-w-full items-center rounded-full border border-border ${
        compact ? 'max-w-[110px] gap-1 px-1.5 text-[10.5px] leading-4' : 'gap-1.5 px-2 py-0.5 text-[11px]'
      }`}
      style={{ background: 'var(--nl-bg-input)' }}
    >
      <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ background: color }} />
      <span className="truncate">{name}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
          className="flex-shrink-0 text-muted-foreground hover:text-foreground"
        >
          ×
        </button>
      )}
    </span>
  )
}
