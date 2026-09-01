import { Plus } from 'lucide-react'
import { Outlet, useLocation } from 'react-router-dom'
import { AppSidebar } from '@/components/AppSidebar'
import { TransactionModals } from '@/components/nl/TransactionModals'
import { useTransactionModalStore } from '@/stores/transactionModalStore'

// Paginas donde el FAB "Agregar rapido" no aplica -- Configuracion no tiene
// nada que agregar rapido, y el boton flotante ahi solo tapaba contenido.
const QUICK_ADD_FAB_HIDDEN_PATHS = ['/settings']

export function Layout() {
  const openQuick = useTransactionModalStore((s) => s.openQuick)
  const { pathname } = useLocation()
  const showQuickAddFab = !QUICK_ADD_FAB_HIDDEN_PATHS.includes(pathname)

  return (
    <div className="min-h-screen lg:h-screen flex flex-col lg:flex-row bg-background text-foreground">
      <AppSidebar />
      <div className="flex-1 min-w-0 lg:min-h-0 flex flex-col">
        {/* flex flex-col ademas de flex-1: no cambia nada para la mayoria de
            las pantallas (su root div sigue sizeando a su contenido, como
            antes), pero le da a Advisor.tsx un `lg:flex-1 lg:min-h-0` real
            para llenar el alto disponible SIN necesitar un `calc(100vh-Npx)`
            a mano ni bleed-ear el padding -- asi su chat queda con el mismo
            gutter que cualquier otra pantalla.

            El `lg:h-screen` de arriba (en vez de solo min-h-screen) es lo
            que de verdad hace el truco, no el min-h-0 solo: min-height NO le
            da a los descendientes flex un tamaño DEFINIDO del cual encoger
            -- sin una altura definida en algun punto de la cadena, el
            "minimo automatico 0" de un item con overflow-auto nunca se
            llega a aplicar de verdad (nunca hay una negociacion real de
            encoger), y todo termina renderizando a su alto de contenido de
            todas formas, empujando la pagina entera. Para paginas normales
            (que SI quieren poder crecer mas de 100vh y hacer scroll normal)
            no cambia nada: si su contenido es mas alto que 100vh, igual
            se desborda visualmente hacia abajo (nada aqui tiene
            overflow-hidden) y el scroll de pagina de siempre sigue
            funcionando igual -- h-screen vs min-h-screen solo importa
            para el calculo de flexbox interno, no para el overflow visible. */}
        <main
          // pb-20 (en vez de solo p-4) deja espacio de sobra abajo en movil para
          // que el FAB "Agregar rapido" (fixed bottom-5, ver mas abajo) nunca
          // quede encima de contenido real al hacer scroll hasta el fondo --
          // confirmado con el calendario de Transacciones, donde sin este
          // padding el FAB tapaba los ultimos dias del mes.
          //
          // OJO: el padding de ARRIBA de <main> se movio a margin-top en el
          // wrapper de <Outlet/> (ver abajo) a proposito -- padding-top en el
          // propio contenedor con scroll se suma al offset "top" del header
          // sticky (ViewHeader usa top-3), asi que con `pt-4`/`lg:pt-7` aqui
          // el header quedaba pegado ~28-40px mas abajo de lo que su propio
          // `top-3` dice, dejando un hueco sin cubrir arriba del header por
          // el que se alcanzaba a ver contenido de mas abajo scrolleando
          // (parecia "ghosting" pero era contenido real, no un glitch de
          // pintado). Un margin-top en un wrapper normal (no el scroll
          // container) da el mismo espacio visual sin arrastrar ese offset.
          className="flex-1 lg:min-h-0 flex flex-col px-4 pb-20 lg:px-8 lg:pb-8 max-w-[1600px] w-full mx-auto overflow-x-hidden"
          style={{ animation: 'fadeInView 150ms ease' }}
        >
          {/* Franja decorativa que tapa con un degradado lo poco que el
              header sticky (top-3, 12px) todavia no cubre arriba suyo.
              h-0 + hijo absoluto: no ocupa espacio en el flujo (nada de
              margin negativo, nada de margin-collapse raro con el mt-4/
              lg:mt-7 de abajo). z-[5] queda por debajo del z-10 del header
              (ViewHeader en primitives.tsx) para que el header, ya opaco,
              siga ganando en la franja donde se solapan. */}
          <div aria-hidden="true" className="sticky top-0 z-[5] h-0 pointer-events-none">
            <div
              className="h-12 w-full"
              style={{
                background:
                  'linear-gradient(to bottom, var(--background) 0%, var(--background) 45%, transparent 100%)',
              }}
            />
          </div>
          {/* flex-1 lg:min-h-0 flex flex-col aqui replica lo que <main> ya
              hacia como contenedor directo de Outlet -- Advisor.tsx depende
              de que su propio `lg:flex-1 lg:min-h-0` encuentre un padre flex
              que si crezca (ver Layout.tsx original y el comentario de
              Advisor.tsx), y ahora ese padre directo es este div, no main. */}
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
