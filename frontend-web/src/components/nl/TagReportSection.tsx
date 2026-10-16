import { Tags as TagsIcon } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { TagSummaryPanel } from '@/components/nl/TagSummaryPanel'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useTags } from '@/hooks/useTags'

/** Reports section: pick a tag and see what it cost, by category and by day. */
export function TagReportSection() {
  const { t } = useTranslation('pages')
  const { data: tags = [] } = useTags()
  const [tagId, setTagId] = useState<string | null>(null)
  const selected = tags.find((tag) => tag.id === tagId) ?? tags[0]

  return (
    <details className="bg-card border border-border rounded-md p-4 mt-4" data-tour="reports:tags">
      <summary className="flex items-center gap-2 text-[15px] font-medium cursor-pointer select-none">
        <TagsIcon size={15} className="text-muted-foreground" />
        {t('reports.tagsHeading')}
      </summary>
      <div className="mt-4 flex flex-col gap-4">
        {!selected ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            {t('reports.tagsEmpty')}{' '}
            <Link to="/tags" className="text-[color:var(--nl-accent-ink)] hover:underline">
              {t('reports.tagsCreate')}
            </Link>
          </p>
        ) : (
          <>
            <Select value={selected.id} onValueChange={(v) => setTagId(v)}>
              <SelectTrigger className="h-9 w-auto self-start">
                <SelectValue>{(v: string) => tags.find((tag) => tag.id === v)?.name ?? v}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {tags.map((tag) => (
                  <SelectItem key={tag.id} value={tag.id}>
                    {tag.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <TagSummaryPanel key={selected.id} tagId={selected.id} />
          </>
        )}
      </div>
    </details>
  )
}
