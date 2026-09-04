import { Plus } from 'lucide-react'
import { Outlet, useLocation } from 'react-router-dom'
import { AppSidebar } from '@/components/AppSidebar'
import { TransactionModals } from '@/components/nl/TransactionModals'
import { useTransactionModalStore } from '@/stores/transactionModalStore'

// Pages where the "Agregar rapido" FAB doesn't apply -- Configuracion has
// nothing to quick-add, and the floating button there only covered content.
const QUICK_ADD_FAB_HIDDEN_PATHS = ['/settings']

export function Layout() {
  const openQuick = useTransactionModalStore((s) => s.openQuick)
  const { pathname } = useLocation()
  const showQuickAddFab = !QUICK_ADD_FAB_HIDDEN_PATHS.includes(pathname)

  return (
    <div className="min-h-screen lg:h-screen flex flex-col lg:flex-row bg-background text-foreground">
      <AppSidebar />
      <div className="flex-1 min-w-0 lg:min-h-0 flex flex-col">
        {/* flex flex-col in addition to flex-1: doesn't change anything for
            most screens (their root div still sizes to its content, as
            before), but it gives Advisor.tsx a real `lg:flex-1 lg:min-h-0`
            to fill the available height WITHOUT needing a hand-rolled
            `calc(100vh-Npx)` or bleeding the padding -- so its chat keeps
            the same gutter as any other screen.

            The `lg:h-screen` above (instead of just min-h-screen) is what
            actually makes this work, not min-h-0 alone: min-height does NOT
            give flex descendants a DEFINED size to shrink from -- without a
            defined height somewhere in the chain, the "automatic minimum 0"
            of an overflow-auto item never truly kicks in (there's never a
            real shrink negotiation), and everything ends up rendering at
            its content height anyway, pushing the whole page. For normal
            pages (which DO want to be able to grow past 100vh and scroll
            normally) nothing changes: if their content is taller than
            100vh, it still visually overflows downward (nothing here has
            overflow-hidden) and the usual page scroll keeps working the
            same -- h-screen vs min-h-screen only matters for the internal
            flexbox calculation, not for the visible overflow. */}
        <main
          // pb-20 (instead of just p-4) leaves extra room at the bottom on
          // mobile so the "Agregar rapido" FAB (fixed bottom-5, see below)
          // never sits on top of real content when scrolling to the bottom --
          // confirmed with the Transacciones calendar, where without this
          // padding the FAB covered the last days of the month.
          //
          // NOTE: the TOP padding of <main> was moved to margin-top on the
          // <Outlet/> wrapper (see below) on purpose -- padding-top on the
          // scroll container itself adds to the sticky header's "top" offset
          // (ViewHeader uses top-3), so with `pt-4`/`lg:pt-7` here the header
          // ended up stuck ~28-40px further down than its own `top-3` says,
          // leaving an uncovered gap above the header through which you
          // could see content from further below while scrolling (it looked
          // like "ghosting" but was real content, not a paint glitch). A
          // margin-top on a normal wrapper (not the scroll container) gives
          // the same visual spacing without carrying that offset along.
          className="flex-1 lg:min-h-0 flex flex-col px-4 pb-20 lg:px-8 lg:pb-8 max-w-[1600px] w-full mx-auto overflow-x-hidden"
          style={{ animation: 'fadeInView 150ms ease' }}
        >
          {/* Decorative strip that covers, with a gradient, the little bit
              that the sticky header (top-3, 12px) still doesn't cover above
              itself. h-0 + absolute child: takes up no space in the flow
              (no negative margin, no weird margin-collapse with the mt-4/
              lg:mt-7 below). z-[5] stays below the header's z-10
              (ViewHeader in primitives.tsx) so the header, already opaque,
              still wins in the strip where they overlap. */}
          <div aria-hidden="true" className="sticky top-0 z-[5] h-0 pointer-events-none">
            <div
              className="h-12 w-full"
              style={{
                background:
                  'linear-gradient(to bottom, var(--background) 0%, var(--background) 45%, transparent 100%)',
              }}
            />
          </div>
          {/* flex-1 lg:min-h-0 flex flex-col here replicates what <main>
              already did as Outlet's direct container -- Advisor.tsx
              depends on its own `lg:flex-1 lg:min-h-0` finding a flex
              parent that actually grows (see the original Layout.tsx and
              the comment in Advisor.tsx), and now that direct parent is
              this div, not main. */}
          <div className="mt-4 lg:mt-7 flex-1 lg:min-h-0 flex flex-col">
            <Outlet />
          </div>
        </main>
      </div>

      {showQuickAddFab && (
        <button
          type="button"
          onClick={openQuick}
          title="Agregar rápido"
          className="fixed bottom-5 right-5 lg:bottom-8 lg:right-10 w-[48px] h-[48px] lg:w-[52px] lg:h-[52px] rounded-full flex items-center justify-center z-30"
          style={{
            background: 'var(--nl-accent)',
            color: 'var(--nl-accent-fg)',
            boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
          }}
        >
          <Plus size={22} strokeWidth={2.2} />
        </button>
      )}

      <TransactionModals />
    </div>
  )
}
