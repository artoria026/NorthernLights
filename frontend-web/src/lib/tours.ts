/** Registro de contenido para el recorrido guiado (Bienvenida + tour con foco,
 * "Propuesta 5" -- ver recorridos-propuestas.html en la raiz del repo, que
 * probo la mecanica visual antes de portarla aqui). Una entrada por modulo;
 * los modulos que todavia no tienen entrada simplemente no muestran el
 * boton de recorrido ni el modal de bienvenida (ver ViewHeader en
 * primitives.tsx) -- asi el rollout es incremental sin tocar tipos. */

export type ModuleKey =
  | 'dashboard'
  | 'advisor'
  | 'accounts'
  | 'transactions'
  | 'budget'
  | 'debts'
  | 'recurring'
  | 'subscriptions'
  | 'insights'
  | 'categories'
  | 'reports'
  | 'settings'
  | 'notifications'

export interface TourStepContent {
  /** Selector CSS de un elemento real de la pantalla, vía atributo
   * `data-tour="<moduleKey>:<elemento>"`. */
  selector: string
  title: string
  text: string
}

export interface TourContent {
  welcome: {
    description: string
    bullets: string[]
  }
  steps: TourStepContent[]
}

export const TOUR_CONTENT: Partial<Record<ModuleKey, TourContent>> = {
  dashboard: {
    welcome: {
      description:
        'Un resumen del estado general de tus finanzas: cuánto dinero líquido tienes, cuánto debes en tarjetas, qué tan cerca estás de tu presupuesto y qué pagos se acercan.',
      bullets: [
        'Ve tu liquidez y deuda revolvente de un vistazo',
        'Compara tu gasto contra el presupuesto del mes y de la semana',
        'Revisa qué pagos vencen pronto antes de que te agarren desprevenido',
      ],
    },
    steps: [
      {
        selector: '[data-tour="dashboard:liquidity"]',
        title: 'Tu dinero disponible',
        text: 'Suma el saldo de tus cuentas tipo efectivo/banco -- no incluye tarjetas de crédito, esas son deuda, no liquidez.',
      },
      {
        selector: '[data-tour="dashboard:budget"]',
        title: 'Qué tan cerca vas del límite',
        text: 'El color cambia de verde a naranja a rojo según qué porcentaje de tu presupuesto del mes ya gastaste.',
      },
      {
        selector: '[data-tour="dashboard:upcoming"]',
        title: 'Próximos pagos',
        text: 'Junta tus gastos recurrentes activos con los pagos de deudas que vencen en los próximos días, para que nada te tome por sorpresa.',
      },
    ],
  },
  accounts: {
    welcome: {
      description:
        'Tus cuentas reales: bancos, efectivo y tarjetas de crédito. El patrimonio neto se calcula sumando el saldo de todas ellas.',
      bullets: [
        'Registra cuentas bancarias, de ahorro, efectivo o tarjetas de crédito',
        'Personaliza cada una con logo y color',
        'Revisa el historial de movimientos de cualquier cuenta',
      ],
    },
    steps: [
      {
        selector: '[data-tour="accounts:new-button"]',
        title: 'Agrega una cuenta',
        text: 'Bancaria, de ahorro, efectivo o tarjeta de crédito -- esta última se registra como una deuda (pasivo), no como dinero disponible.',
      },
      {
        selector: '[data-tour="accounts:list"]',
        title: 'Activos y pasivos',
        text: 'Tus cuentas se agrupan en Activos (dinero tuyo) y Pasivos (tarjetas de crédito). El patrimonio neto de abajo es la resta de ambos.',
      },
      {
        selector: '[data-tour="accounts:detail"]',
        title: 'Movimientos de la cuenta',
        text: 'Selecciona cualquier cuenta a la izquierda para ver aquí su historial completo, con filtro de entradas/salidas y buscador.',
      },
    ],
  },
  transactions: {
    welcome: {
      description:
        'El historial completo de tus movimientos: ingresos, gastos, transferencias y préstamos. Puedes filtrar por cuenta, tipo, fecha o texto.',
      bullets: [
        'Registra ingresos, gastos y transferencias entre cuentas',
        'Divide un gasto compartido y cobra tu parte después',
        'Filtra por cuenta, texto o un día específico del calendario',
      ],
    },
    steps: [
      {
        selector: '[data-tour="transactions:new-button"]',
        title: 'Registra un movimiento',
        text: 'Para ingreso o gasto solo eliges cuenta, categoría y monto -- la app resuelve sola la contraparte contable.',
      },
      {
        selector: '[data-tour="transactions:filters"]',
        title: 'Encuentra lo que buscas',
        text: 'Busca por texto o filtra por cuenta -- la lista de abajo se actualiza al momento.',
      },
      {
        selector: '[data-tour="transactions:calendar"]',
        title: 'Vista de calendario',
        text: 'Los mismos datos como calendario -- haz click en un día para filtrar la lista automáticamente a ese día.',
      },
    ],
  },
  budget: {
    welcome: {
      description:
        'Cuánto planeas gastar por categoría de gasto variable (comida, transporte, etc.) cada mes, contra lo que realmente llevas gastado.',
      bullets: [
        'Ponle un tope mensual a cualquier categoría, es opcional una por una',
        'Recibe una sugerencia de límite basada en tu gasto promedio',
        'Navega meses pasados para ver cómo te fue',
      ],
    },
    steps: [
      {
        selector: '[data-tour="budget:new-limit"]',
        title: 'Define un límite',
        text: 'Si no le pones límite a ninguna categoría, no aparece nada en el desglose -- es opcional, categoría por categoría.',
      },
      {
        selector: '[data-tour="budget:available"]',
        title: 'Lo que te queda',
        text: 'Ingreso estimado menos comprometido fijo (deudas y recurrentes) menos gastado. En rojo si ya te pasaste.',
      },
      {
        selector: '[data-tour="budget:month-nav"]',
        title: 'Revisa meses anteriores',
        text: 'La vista semanal y la alerta de límite solo aplican al mes en curso -- un mes cerrado ya no tiene "semana actual".',
      },
    ],
  },
  debts: {
    welcome: {
      description:
        'Todo lo que involucra deber dinero, en cualquier dirección: tarjetas de crédito, préstamos personales, o algo tan informal como prestarle $100 a un amigo.',
      bullets: [
        'Registra deudas con su plan completo: monto, frecuencia y cuenta',
        'Cambia entre "Yo debo" y "Me deben" -- misma pantalla, distinta dirección',
        'Registra pagos/cobros reales que mueven dinero de una cuenta',
      ],
    },
    steps: [
      {
        selector: '[data-tour="debts:new-button"]',
        title: 'Registra una deuda',
        text: 'Monto, frecuencia de pago y, si aplica, de/a qué cuenta se movió el efectivo cuando se originó.',
      },
      {
        selector: '[data-tour="debts:direction-toggle"]',
        title: 'Dos direcciones, misma pantalla',
        text: '"Yo debo" y "Me deben" usan el mismo modelo -- solo cambia quién le debe a quién.',
      },
      {
        selector: '[data-tour="debts:summary"]',
        title: 'Tu panorama de deuda',
        text: 'El total pendiente y, si aplica, cuánto de eso está comprometido cada mes.',
      },
    ],
  },
  recurring: {
    welcome: {
      description:
        'Gastos e ingresos que se repiten en un ciclo fijo -- servicios, utilities e ingresos recurrentes como una nómina. Las suscripciones tienen su propia página.',
      bullets: [
        'Registra un recurrente y define su frecuencia de cobro',
        'Confirma o rechaza cada movimiento antes de que cuente como real',
        'Revisa qué se cobra en los próximos 7 días',
      ],
    },
    steps: [
      {
        selector: '[data-tour="recurring:new-button"]',
        title: 'Agrega un recurrente',
        text: 'Servicios, utilities o un ingreso fijo como nómina -- define monto y frecuencia una sola vez.',
      },
      {
        selector: '[data-tour="recurring:pending"]',
        title: 'Confirma antes de que cuente',
        text: 'Cuando se acerca la fecha, el sistema prepara el movimiento como borrador -- lo confirmas o lo rechazas antes de que sea una transacción real.',
      },
      {
        selector: '[data-tour="recurring:upcoming"]',
        title: 'Próximos 7 días',
        text: 'Para planear tu quincena sabiendo qué se te viene encima.',
      },
    ],
  },
  subscriptions: {
    welcome: {
      description:
        'Tus suscripciones (streaming, software, membresías) por separado de otros recurrentes, para ver de un vistazo cuánto te cuestan al mes.',
      bullets: [
        'Registra una suscripción con su frecuencia de cobro',
        'El total convierte cada frecuencia a su equivalente mensual',
        'Un aviso pasivo te recuerda las que llevan más de 12 meses activas',
      ],
    },
    steps: [
      {
        selector: '[data-tour="subscriptions:new-button"]',
        title: 'Agrega una suscripción',
        text: 'Streaming, software o cualquier membresía -- monto, frecuencia y cuenta desde donde se cobra.',
      },
      {
        selector: '[data-tour="subscriptions:committed"]',
        title: 'Cuánto te cuesta al mes',
        text: 'Como no todas cobran mensual (algunas son anuales), el total convierte cada frecuencia a su equivalente mensual.',
      },
      {
        selector: '[data-tour="subscriptions:renewals"]',
        title: 'Próximas renovaciones',
        text: 'Lo que se renueva en los próximos 7 días, para que ningún cobro te agarre desprevenido.',
      },
    ],
  },
  advisor: {
    welcome: {
      description:
        'Un chat con IA que ve tu situación financiera real (cuentas, deudas, presupuesto, transacciones) y responde con eso como contexto -- no son respuestas genéricas.',
      bullets: [
        'Pregunta lo que quieras sobre tu situación financiera',
        'Adjunta estados de cuenta en PDF para traer datos históricos',
        'Pídele que guarde un plan y lo verás después en Insights',
      ],
    },
    steps: [
      {
        selector: '[data-tour="advisor:attach"]',
        title: 'Trae tus estados de cuenta',
        text: 'Adjunta PDFs (aunque tengan contraseña) -- separa cargos normales de compras a meses y evita duplicados entre estados del mismo lote.',
      },
      {
        selector: '[data-tour="advisor:input"]',
        title: 'Pregunta lo que quieras',
        text: 'Los botones de preguntas comunes son solo un punto de partida -- escribe tu pregunta real aquí.',
      },
      {
        selector: '[data-tour="advisor:usage"]',
        title: 'Consultas restantes hoy',
        text: 'Hay un límite diario para controlar el costo de la IA -- se reinicia cada día.',
      },
    ],
  },
  insights: {
    welcome: {
      description:
        'Observaciones automáticas sobre tus finanzas basadas en tus datos reales: un patrón detectado, una alerta, una sugerencia.',
      bullets: [
        'Genera un análisis nuevo sobre tu situación actual',
        'Márcalos como resuelto o descártalos cuando ya no apliquen',
        'Cada insight activo se revisa solo con el tiempo',
      ],
    },
    steps: [
      {
        selector: '[data-tour="insights:generate"]',
        title: 'Genera un análisis nuevo',
        text: 'Corre el análisis sobre tu situación actual y crea insights si encuentra algo que valga la pena señalarte.',
      },
      {
        selector: '[data-tour="insights:active"]',
        title: 'Máximo 10 activos',
        text: 'Cuando resuelves o descartas uno, sale de esta lista y pasa al historial de abajo.',
      },
      {
        selector: '[data-tour="insights:history"]',
        title: 'Todo lo que ya viste',
        text: 'Insights resueltos o descartados quedan aquí, con su categoría y fecha.',
      },
    ],
  },
  reports: {
    welcome: {
      description:
        'Reportes de periodos ya cerrados (mes o año anterior) -- una "foto" congelada de un periodo que ya terminó, con análisis generado sobre esos números.',
      bullets: [
        'Genera el reporte del mes o año anterior cuando quieras verlo',
        'Filtra entre ingresos, egresos o todos los movimientos',
        'Sigue tu patrimonio neto histórico a través de los meses',
      ],
    },
    steps: [
      {
        selector: '[data-tour="reports:generate-month"]',
        title: 'Genera un reporte',
        text: 'Los reportes no se crean solos -- los generas cuando quieras verlos.',
      },
      {
        selector: '[data-tour="reports:period-toggle"]',
        title: 'Mensual o anual',
        text: 'Un reporte anual necesita que ya existan los reportes mensuales de ese año.',
      },
      {
        selector: '[data-tour="reports:regenerate"]',
        title: 'Regenera si algo cambió',
        text: 'Recalcula desde cero el reporte que estás viendo con tus transacciones actuales -- útil si lo generaste antes de cargar historial viejo.',
      },
    ],
  },
  settings: {
    welcome: {
      description:
        'Tu perfil y las preferencias de tu cuenta -- no configuración de una pantalla en particular, sino de toda la app.',
      bullets: [
        'Actualiza tu foto de perfil y contraseña',
        'El tema se guarda en tu cuenta, no en este navegador',
        'Borra datos específicos sin perder tu cuenta',
      ],
    },
    steps: [
      {
        selector: '[data-tour="settings:profile"]',
        title: 'Tu perfil',
        text: 'Nombre, foto y contraseña. Si entraste con Google, tu foto se importa la primera vez.',
      },
      {
        selector: '[data-tour="settings:preferences"]',
        title: 'Tema y ciclo de pago',
        text: 'El tema se guarda en tu cuenta -- si entras desde otro dispositivo, se ve igual. El ciclo de pago alimenta Dashboard y Presupuesto.',
      },
      {
        selector: '[data-tour="settings:data"]',
        title: 'Empieza de cero sin perder tu cuenta',
        text: 'Borra todo excepto cuentas, absolutamente todo, o solo categorías específicas como transacciones o el historial del Asesor IA.',
      },
    ],
  },
  notifications: {
    welcome: {
      description:
        'Todos los avisos que te ha generado la app: reportes listos, insights nuevos, alertas de presupuesto o deuda, y recordatorios de pagos pendientes.',
      bullets: [
        'Un punto de color marca lo que no has leído',
        'Marca todo como leído de una sola vez',
        'El ícono y color de cada una indican su tipo sin tener que abrirla',
      ],
    },
    steps: [
      {
        selector: '[data-tour="notifications:mark-all"]',
        title: 'Marca todo de una vez',
        text: 'En vez de abrir una por una, esto las marca todas como leídas al momento.',
      },
      {
        selector: '[data-tour="notifications:list"]',
        title: 'Tu lista de avisos',
        text: 'Click en cualquiera para marcarla como leída y ver su detalle.',
      },
    ],
  },
  categories: {
    welcome: {
      description:
        'Aquí organizas en qué se va (y de dónde viene) tu dinero. Cada transacción pertenece a una categoría, y las de gasto pueden tener subcategorías propias.',
      bullets: [
        'Crea categorías con color e ícono propio',
        'Agrupa gastos parecidos en subcategorías',
        'Compara cuánto gastas por categoría cada mes',
      ],
    },
    steps: [
      {
        selector: '[data-tour="categories:new-button"]',
        title: 'Crea categorías nuevas',
        text: 'Dale nombre, color e ícono a cualquier categoría que todavía no tengas -- hay más de 150 íconos para elegir, agrupados por tema.',
      },
      {
        selector: '[data-tour="categories:first-card"]',
        title: 'Así se ve cada categoría',
        text: 'El monto de arriba es lo gastado (o recibido) este mes. Si tiene subcategorías, puedes desplegarlas para ver el detalle.',
      },
      {
        selector: '[data-tour="categories:segbar"]',
        title: 'Desglose por subcategoría',
        text: 'Cada color de la barra es una subcategoría distinta, comparada contra el gasto directo de la categoría. Pasa el mouse para ver el monto exacto.',
      },
      {
        selector: '[data-tour="categories:help-button"]',
        title: '¿Dudas después?',
        text: 'Vuelve a este ícono cuando quieras repasar todo esto de nuevo, sin tener que buscarlo.',
      },
    ],
  },
}
