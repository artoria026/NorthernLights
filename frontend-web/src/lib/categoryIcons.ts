import {
  Activity,
  Anchor,
  Apple,
  Armchair,
  Award,
  Baby,
  Backpack,
  Banana,
  Bandage,
  Banknote,
  BarChart3,
  Bed,
  Beer,
  Bell,
  Bike,
  Bird,
  BookOpen,
  Boxes,
  Brain,
  Briefcase,
  Building,
  Building2,
  Bug,
  Bus,
  Cake,
  Calculator,
  Calendar,
  Camera,
  Candy,
  Car,
  CarFront,
  Carrot,
  Cat,
  Cherry,
  Church,
  Clapperboard,
  Cloud,
  Coffee,
  Coins,
  Compass,
  Cpu,
  CreditCard,
  Croissant,
  Crown,
  CupSoda,
  Diamond,
  Dice5,
  DollarSign,
  DoorOpen,
  Drama,
  Droplet,
  Drumstick,
  Dumbbell,
  Ear,
  Egg,
  Eye,
  Fan,
  Feather,
  FileText,
  Film,
  Flag,
  Flame,
  Folder,
  Footprints,
  Fuel,
  Gamepad2,
  Gem,
  Gift,
  Glasses,
  GraduationCap,
  Guitar,
  Hammer,
  HandCoins,
  Handshake,
  Headphones,
  Heart,
  HeartPulse,
  Home,
  IceCreamCone,
  Joystick,
  Key,
  Lamp,
  Landmark,
  Laptop,
  Lightbulb,
  LineChart,
  Mic,
  Milk,
  Moon,
  Mountain,
  Music,
  MoreHorizontal,
  Navigation,
  Package,
  PaintRoller,
  Palette,
  ParkingCircle,
  PartyPopper,
  PawPrint,
  Percent,
  Pill,
  PiggyBank,
  Pizza,
  Plane,
  Plug,
  PlusCircle,
  Podcast,
  Presentation,
  Puzzle,
  Rabbit,
  Radio,
  Rainbow,
  Receipt,
  Refrigerator,
  Rocket,
  Route,
  Salad,
  Sandwich,
  Scissors,
  Shirt,
  ShieldPlus,
  ShoppingBag,
  ShoppingCart,
  Ship,
  Smartphone,
  Snowflake,
  Sofa,
  Soup,
  Sparkles,
  Star,
  Stethoscope,
  Store,
  Sun,
  Syringe,
  Tag,
  Target,
  Thermometer,
  Ticket,
  TrafficCone,
  Train,
  TreePine,
  TrendingUp,
  Trophy,
  Truck,
  Tv,
  Umbrella,
  User,
  Users,
  Utensils,
  Wallet,
  WashingMachine,
  Watch,
  Waves,
  Wine,
  Wrench,
  MapPin,
  type LucideIcon,
} from 'lucide-react'

import i18n from './i18n'

/** Key = same kebab-case format as categories.icon in the DB (see
 * seed/migrations for system categories, e.g. "paw-print", "gamepad-2")
 * -- so system categories already render fine without touching data.
 * NEVER rename/remove an existing key: it breaks the icon of any category
 * (system or user-created) already saved with that value. New ones can be
 * added freely. */
const CATEGORY_ICON_MAP: Record<string, LucideIcon> = {
  utensils: Utensils,
  wine: Wine,
  car: Car,
  home: Home,
  cpu: Cpu,
  heart: Heart,
  'paw-print': PawPrint,
  user: User,
  'gamepad-2': Gamepad2,
  wrench: Wrench,
  shirt: Shirt,
  'credit-card': CreditCard,
  'more-horizontal': MoreHorizontal,
  briefcase: Briefcase,
  laptop: Laptop,
  'plus-circle': PlusCircle,
  'shopping-bag': ShoppingBag,
  fuel: Fuel,
  plane: Plane,
  'graduation-cap': GraduationCap,
  gift: Gift,
  'piggy-bank': PiggyBank,
  smartphone: Smartphone,
  dumbbell: Dumbbell,
  coffee: Coffee,
  music: Music,
  film: Film,
  baby: Baby,
  'trending-up': TrendingUp,
  landmark: Landmark,
  banknote: Banknote,
  // -- first expansion (previously 29) --
  pizza: Pizza,
  apple: Apple,
  cake: Cake,
  'shopping-cart': ShoppingCart,
  croissant: Croissant,
  beer: Beer,
  bus: Bus,
  train: Train,
  bike: Bike,
  'parking-circle': ParkingCircle,
  lightbulb: Lightbulb,
  sofa: Sofa,
  key: Key,
  droplet: Droplet,
  bed: Bed,
  'building-2': Building2,
  pill: Pill,
  stethoscope: Stethoscope,
  activity: Activity,
  glasses: Glasses,
  watch: Watch,
  footprints: Footprints,
  headphones: Headphones,
  camera: Camera,
  'book-open': BookOpen,
  palette: Palette,
  ticket: Ticket,
  clapperboard: Clapperboard,
  wallet: Wallet,
  receipt: Receipt,
  'hand-coins': HandCoins,
  star: Star,
  sun: Sun,
  umbrella: Umbrella,
  'tree-pine': TreePine,
  cat: Cat,
  // -- second expansion: grouped by theme (see CATEGORY_ICON_META) --
  'ice-cream': IceCreamCone,
  soup: Soup,
  sandwich: Sandwich,
  cherry: Cherry,
  banana: Banana,
  carrot: Carrot,
  milk: Milk,
  'cup-soda': CupSoda,
  egg: Egg,
  salad: Salad,
  drumstick: Drumstick,
  candy: Candy,
  truck: Truck,
  ship: Ship,
  anchor: Anchor,
  compass: Compass,
  navigation: Navigation,
  'traffic-cone': TrafficCone,
  'car-front': CarFront,
  route: Route,
  rocket: Rocket,
  'map-pin': MapPin,
  hammer: Hammer,
  plug: Plug,
  fan: Fan,
  thermometer: Thermometer,
  'door-open': DoorOpen,
  'washing-machine': WashingMachine,
  refrigerator: Refrigerator,
  lamp: Lamp,
  armchair: Armchair,
  boxes: Boxes,
  package: Package,
  'paint-roller': PaintRoller,
  syringe: Syringe,
  brain: Brain,
  eye: Eye,
  ear: Ear,
  'heart-pulse': HeartPulse,
  'shield-plus': ShieldPlus,
  waves: Waves,
  bandage: Bandage,
  crown: Crown,
  gem: Gem,
  scissors: Scissors,
  diamond: Diamond,
  backpack: Backpack,
  sparkles: Sparkles,
  tv: Tv,
  radio: Radio,
  guitar: Guitar,
  drama: Drama,
  trophy: Trophy,
  dice: Dice5,
  'party-popper': PartyPopper,
  mic: Mic,
  podcast: Podcast,
  puzzle: Puzzle,
  joystick: Joystick,
  calculator: Calculator,
  'file-text': FileText,
  folder: Folder,
  building: Building,
  store: Store,
  'line-chart': LineChart,
  'bar-chart': BarChart3,
  coins: Coins,
  'dollar-sign': DollarSign,
  percent: Percent,
  handshake: Handshake,
  target: Target,
  presentation: Presentation,
  flame: Flame,
  snowflake: Snowflake,
  moon: Moon,
  cloud: Cloud,
  rainbow: Rainbow,
  mountain: Mountain,
  feather: Feather,
  bug: Bug,
  bird: Bird,
  rabbit: Rabbit,
  users: Users,
  award: Award,
  flag: Flag,
  bell: Bell,
  calendar: Calendar,
  church: Church,
}

export const CATEGORY_ICON_GROUPS = [
  'foodAndDrink',
  'transport',
  'home',
  'health',
  'styleAndCare',
  'leisure',
  'workAndMoney',
  'other',
] as const
export type CategoryIconGroup = (typeof CATEGORY_ICON_GROUPS)[number]

/** Theme group (for the picker rail) and extra synonyms for the search --
 * "gasolina" should find `fuel`, not just someone who already knows it's
 * called "fuel" in the system.
 *
 * `keywords` stay hardcoded in Spanish on purpose -- they're search-matching
 * synonyms, never displayed, and translating them is out of scope for now
 * (see categoryIconLabel/categoryIconGroupLabel for the actually-displayed,
 * translated text). */
export const CATEGORY_ICON_META: Record<string, { group: CategoryIconGroup; keywords?: string[] }> = {
  utensils: { group: 'foodAndDrink', keywords: ['restaurante', 'comer'] },
  wine: { group: 'foodAndDrink', keywords: ['bebida', 'alcohol', 'copa'] },
  beer: { group: 'foodAndDrink', keywords: ['bebida', 'alcohol'] },
  coffee: { group: 'foodAndDrink', keywords: ['bebida'] },
  pizza: { group: 'foodAndDrink' },
  apple: { group: 'foodAndDrink', keywords: ['manzana', 'sano'] },
  cake: { group: 'foodAndDrink', keywords: ['pastel', 'dulce'] },
  croissant: { group: 'foodAndDrink', keywords: ['pan'] },
  'shopping-cart': { group: 'foodAndDrink', keywords: ['supermercado', 'despensa'] },
  'ice-cream': { group: 'foodAndDrink', keywords: ['nieve', 'paleta'] },
  soup: { group: 'foodAndDrink', keywords: ['caldo'] },
  sandwich: { group: 'foodAndDrink', keywords: ['torta'] },
  cherry: { group: 'foodAndDrink', keywords: ['cereza'] },
  banana: { group: 'foodAndDrink', keywords: ['plátano'] },
  carrot: { group: 'foodAndDrink', keywords: ['zanahoria'] },
  milk: { group: 'foodAndDrink', keywords: ['lácteos'] },
  'cup-soda': { group: 'foodAndDrink', keywords: ['soda'] },
  egg: { group: 'foodAndDrink' },
  salad: { group: 'foodAndDrink', keywords: ['sano'] },
  drumstick: { group: 'foodAndDrink', keywords: ['pollo'] },
  candy: { group: 'foodAndDrink', keywords: ['golosinas'] },

  car: { group: 'transport', keywords: ['carro', 'coche'] },
  fuel: { group: 'transport', keywords: ['combustible', 'gas'] },
  bus: { group: 'transport', keywords: ['transporte público', 'autobús'] },
  train: { group: 'transport', keywords: ['metro'] },
  bike: { group: 'transport', keywords: ['bicicleta'] },
  plane: { group: 'transport', keywords: ['vuelo', 'viaje'] },
  'parking-circle': { group: 'transport', keywords: ['parquímetro'] },
  truck: { group: 'transport', keywords: ['mudanza'] },
  ship: { group: 'transport', keywords: ['crucero'] },
  anchor: { group: 'transport', keywords: ['ancla', 'barco'] },
  compass: { group: 'transport', keywords: ['viaje'] },
  navigation: { group: 'transport', keywords: ['gps', 'mapa'] },
  'traffic-cone': { group: 'transport', keywords: ['obra', 'vialidad'] },
  'car-front': { group: 'transport' },
  route: { group: 'transport', keywords: ['camino'] },
  rocket: { group: 'transport', keywords: ['cohete', 'lanzamiento'] },
  'map-pin': { group: 'transport', keywords: ['destino'] },

  home: { group: 'home', keywords: ['hogar', 'renta'] },
  wrench: { group: 'home', keywords: ['reparación', 'herramienta'] },
  lightbulb: { group: 'home', keywords: ['electricidad', 'cfe'] },
  droplet: { group: 'home' },
  sofa: { group: 'home' },
  bed: { group: 'home' },
  key: { group: 'home', keywords: ['renta', 'depósito'] },
  'building-2': { group: 'home', keywords: ['condominio', 'mantenimiento'] },
  hammer: { group: 'home', keywords: ['reparación'] },
  plug: { group: 'home', keywords: ['electricidad'] },
  fan: { group: 'home', keywords: ['clima'] },
  thermometer: { group: 'home', keywords: ['clima', 'clima artificial'] },
  'door-open': { group: 'home', keywords: ['acceso'] },
  'washing-machine': { group: 'home', keywords: ['lavandería'] },
  refrigerator: { group: 'home', keywords: ['electrodoméstico'] },
  lamp: { group: 'home', keywords: ['iluminación'] },
  armchair: { group: 'home', keywords: ['muebles'] },
  boxes: { group: 'home', keywords: ['cajas'] },
  package: { group: 'home', keywords: ['envío', 'entrega'] },
  'paint-roller': { group: 'home', keywords: ['remodelación'] },

  heart: { group: 'health', keywords: ['corazón'] },
  pill: { group: 'health', keywords: ['farmacia'] },
  stethoscope: { group: 'health', keywords: ['consulta', 'médico'] },
  activity: { group: 'health', keywords: ['ejercicio'] },
  dumbbell: { group: 'health', keywords: ['ejercicio', 'pesas'] },
  glasses: { group: 'health', keywords: ['óptica'] },
  syringe: { group: 'health', keywords: ['inyección'] },
  brain: { group: 'health', keywords: ['psicología', 'terapia'] },
  eye: { group: 'health', keywords: ['oftalmología'] },
  ear: { group: 'health', keywords: ['audición'] },
  'heart-pulse': { group: 'health' },
  'shield-plus': { group: 'health' },
  waves: { group: 'health', keywords: ['relajación', 'masaje'] },
  bandage: { group: 'health', keywords: ['herida'] },

  shirt: { group: 'styleAndCare' },
  watch: { group: 'styleAndCare', keywords: ['accesorio'] },
  footprints: { group: 'styleAndCare', keywords: ['zapatos'] },
  'shopping-bag': { group: 'styleAndCare' },
  crown: { group: 'styleAndCare' },
  gem: { group: 'styleAndCare' },
  scissors: { group: 'styleAndCare', keywords: ['estética', 'salón'] },
  diamond: { group: 'styleAndCare', keywords: ['accesorio'] },
  backpack: { group: 'styleAndCare' },
  sparkles: { group: 'styleAndCare', keywords: ['brillo', 'cuidado personal'] },

  'gamepad-2': { group: 'leisure' },
  music: { group: 'leisure' },
  headphones: { group: 'leisure', keywords: ['música'] },
  film: { group: 'leisure', keywords: ['película'] },
  clapperboard: { group: 'leisure', keywords: ['película', 'serie'] },
  camera: { group: 'leisure' },
  'book-open': { group: 'leisure', keywords: ['lectura'] },
  palette: { group: 'leisure', keywords: ['creatividad'] },
  ticket: { group: 'leisure', keywords: ['evento', 'concierto'] },
  tv: { group: 'leisure' },
  radio: { group: 'leisure' },
  guitar: { group: 'leisure' },
  drama: { group: 'leisure' },
  trophy: { group: 'leisure', keywords: ['logro', 'deporte'] },
  dice: { group: 'leisure' },
  'party-popper': { group: 'leisure', keywords: ['celebración'] },
  mic: { group: 'leisure', keywords: ['micrófono'] },
  podcast: { group: 'leisure' },
  puzzle: { group: 'leisure', keywords: ['pasatiempo'] },
  joystick: { group: 'leisure' },

  cpu: { group: 'workAndMoney', keywords: ['electrónica'] },
  laptop: { group: 'workAndMoney' },
  smartphone: { group: 'workAndMoney', keywords: ['teléfono'] },
  briefcase: { group: 'workAndMoney', keywords: ['oficina'] },
  'trending-up': { group: 'workAndMoney', keywords: ['ahorro'] },
  'piggy-bank': { group: 'workAndMoney', keywords: ['alcancía'] },
  landmark: { group: 'workAndMoney' },
  banknote: { group: 'workAndMoney', keywords: ['dinero'] },
  'credit-card': { group: 'workAndMoney' },
  wallet: { group: 'workAndMoney', keywords: ['dinero'] },
  receipt: { group: 'workAndMoney', keywords: ['factura'] },
  'hand-coins': { group: 'workAndMoney', keywords: ['propina'] },
  calculator: { group: 'workAndMoney' },
  'file-text': { group: 'workAndMoney', keywords: ['papeleo'] },
  folder: { group: 'workAndMoney' },
  building: { group: 'workAndMoney', keywords: ['empresa'] },
  store: { group: 'workAndMoney', keywords: ['tienda'] },
  'line-chart': { group: 'workAndMoney', keywords: ['inversión'] },
  'bar-chart': { group: 'workAndMoney' },
  coins: { group: 'workAndMoney' },
  'dollar-sign': { group: 'workAndMoney', keywords: ['divisa'] },
  percent: { group: 'workAndMoney', keywords: ['comisión', 'tasa'] },
  handshake: { group: 'workAndMoney', keywords: ['trato', 'sociedad'] },
  target: { group: 'workAndMoney', keywords: ['objetivo'] },
  presentation: { group: 'workAndMoney', keywords: ['junta'] },

  'graduation-cap': { group: 'other', keywords: ['escuela', 'universidad'] },
  gift: { group: 'other' },
  'paw-print': { group: 'other', keywords: ['perro', 'gato'] },
  cat: { group: 'other' },
  baby: { group: 'other', keywords: ['hijo', 'hija'] },
  star: { group: 'other' },
  sun: { group: 'other', keywords: ['sol', 'playa'] },
  umbrella: { group: 'other', keywords: ['protección'] },
  'tree-pine': { group: 'other', keywords: ['exterior'] },
  user: { group: 'other' },
  'plus-circle': { group: 'other' },
  'more-horizontal': { group: 'other' },
  flame: { group: 'other' },
  snowflake: { group: 'other', keywords: ['frío'] },
  moon: { group: 'other' },
  cloud: { group: 'other' },
  rainbow: { group: 'other' },
  mountain: { group: 'other', keywords: ['montaña', 'exterior'] },
  feather: { group: 'other', keywords: ['ligero'] },
  bug: { group: 'other' },
  bird: { group: 'other', keywords: ['pájaro'] },
  rabbit: { group: 'other', keywords: ['mascota'] },
  users: { group: 'other', keywords: ['grupo', 'compartido'] },
  award: { group: 'other', keywords: ['logro'] },
  flag: { group: 'other', keywords: ['bandera', 'objetivo'] },
  bell: { group: 'other', keywords: ['notificación'] },
  calendar: { group: 'other', keywords: ['fecha'] },
  church: { group: 'other', keywords: ['iglesia'] },
}

/** Curated subset for the create/edit picker -- all resolve via
 * CATEGORY_ICON_MAP and have an entry in CATEGORY_ICON_META. */
export const CATEGORY_ICON_CHOICES: string[] = Object.keys(CATEGORY_ICON_MAP)

export function categoryIcon(iconName: string | null | undefined): LucideIcon {
  if (!iconName) return Tag
  return CATEGORY_ICON_MAP[iconName] ?? Tag
}

export function categoryIconLabel(iconName: string): string {
  return i18n.t(`categories:icons.${iconName}`, { defaultValue: iconName })
}

/** Translated label for a theme group (picker rail section heading). */
export function categoryIconGroupLabel(group: CategoryIconGroup): string {
  return i18n.t(`categories:groups.${group}`)
}

/** The icons of a theme group, in the same order as CATEGORY_ICON_CHOICES. */
export function iconsInGroup(group: CategoryIconGroup): string[] {
  return CATEGORY_ICON_CHOICES.filter((name) => CATEGORY_ICON_META[name]?.group === group)
}

/** Text to search against: the key, the translated name, and synonyms. All
 * lowercase, without accents, so that "cafe" finds "café". */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

export function matchesIconSearch(iconName: string, query: string): boolean {
  const q = normalize(query.trim())
  if (!q) return true
  const meta = CATEGORY_ICON_META[iconName]
  const haystack = [iconName, categoryIconLabel(iconName), ...(meta?.keywords ?? [])].filter(Boolean).join(' ')
  return normalize(haystack).includes(q)
}

const RECENT_ICONS_KEY = 'nl:recent-category-icons'
const MAX_RECENT_ICONS = 8

/** Last icons chosen by this user in this browser -- localStorage on
 * purpose (not worth a backend table/endpoint for a purely picker-UX
 * preference). Read/written only from IconGridPicker. */
export function getRecentCategoryIcons(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_ICONS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((v): v is string => typeof v === 'string' && v in CATEGORY_ICON_MAP)
  } catch {
    return []
  }
}

export function recordRecentCategoryIcon(iconName: string): void {
  try {
    const current = getRecentCategoryIcons().filter((i) => i !== iconName)
    const next = [iconName, ...current].slice(0, MAX_RECENT_ICONS)
    localStorage.setItem(RECENT_ICONS_KEY, JSON.stringify(next))
  } catch {
    // localStorage not available (private mode, etc.) -- not critical, ignored
  }
}

/** The first 7 are the original palette, the same one already used by
 * system categories (see migration 4bb6c6945c68_distinct_system_category_colors)
 * -- kept intact and in the same order so as not to shift the default
 * (CATEGORY_COLOR_CHOICES[0]) or the color of any already-saved category.
 * The rest are an expansion (same criteria: enough contrast for the white
 * icon on top, see CategoryCard). The picker (ColorSwatchPicker in
 * Categorias.tsx) also lets you pick ANY hex via a native <input
 * type="color"> -- this list is no longer the ceiling, it's the quick
 * shortcut. */
export const CATEGORY_COLOR_CHOICES = [
  '#00c9a7', // --nl-accent (teal)
  '#4e8ef0', // --nl-blue
  '#f5a623', // --nl-warning (orange)
  '#8b7cf6', // --nl-violet
  '#f04e4e', // --nl-danger (red)
  '#e85d9c', // --nl-pink
  '#6f6f76', // --nl-text-secondary (neutral gray)
  '#16a34a', // green
  '#ca8a04', // mustard
  '#0891b2', // cyan
  '#6366f1', // indigo
  '#92400e', // brown
  '#334155', // navy blue
  '#c026d3', // fuchsia
]
