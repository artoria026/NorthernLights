import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { DISCLAIMER_TEXT } from '@/lib/disclaimer'

/** Mismo texto en los 3 lugares donde se muestra el aviso (registro,
 * DisclaimerGate, Ajustes) -- un solo componente para no divergir el estilo
 * entre ellos. */
const COMPONENTS = {
  h2: ({ ...props }) => (
    <h2 className="text-[15px] font-semibold mt-5 mb-2 first:mt-0" {...props} />
  ),
  h3: ({ ...props }) => <h3 className="text-[13.5px] font-semibold mt-3 mb-1.5" {...props} />,
  p: ({ ...props }) => <p className="mb-2.5 last:mb-0 leading-relaxed" {...props} />,
  ul: ({ ...props }) => <ul className="mb-2.5 last:mb-0 pl-4 list-disc space-y-1" {...props} />,
  li: ({ ...props }) => <li {...props} />,
  strong: ({ ...props }) => <strong className="font-semibold text-foreground" {...props} />,
  code: ({ ...props }) => (
    <code className="rounded px-1 py-0.5 text-[12px]" style={{ background: 'var(--nl-bg-track)' }} {...props} />
  ),
}

export function DisclaimerContent() {
  return (
    <div className="text-[13px] text-muted-foreground">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {DISCLAIMER_TEXT}
      </ReactMarkdown>
    </div>
  )
}
