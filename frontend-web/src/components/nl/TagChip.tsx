/** A tag as a small label: a dot in the tag's own color and its name. */
export function TagChip({ name, color, onRemove, removeLabel }: { name: string; color: string; onRemove?: () => void; removeLabel?: string }) {
  return (
    <span
      title={name}
      className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-[11px]"
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
