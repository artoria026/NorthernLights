import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'
import {
  faAirbnb,
  faAmazon,
  faAndroid,
  faApple,
  faAws,
  faBitcoin,
  faCloudflare,
  faDeezer,
  faDiscord,
  faDocker,
  faDropbox,
  faFacebook,
  faFigma,
  faGithub,
  faGitlab,
  faGoogle,
  faGoogleDrive,
  faInstagram,
  faLinkedin,
  faMedium,
  faMicrosoft,
  faPatreon,
  faPaypal,
  faPlaystation,
  faReddit,
  faShopify,
  faSkype,
  faSlack,
  faSoundcloud,
  faSpotify,
  faSteam,
  faStripe,
  faTelegram,
  faTiktok,
  faTwitch,
  faUber,
  faVimeo,
  faWhatsapp,
  faWordpress,
  faXTwitter,
  faXbox,
  faYoutube,
} from '@fortawesome/free-brands-svg-icons'
import {
  BookOpen,
  Briefcase,
  Camera,
  Car,
  Clapperboard,
  Cloud,
  Droplet,
  Dumbbell,
  Flame,
  Gamepad2,
  GraduationCap,
  Globe,
  Headphones,
  HeartPulse,
  Home,
  Lock,
  Mail,
  Music,
  Newspaper,
  Package,
  Palette,
  Server,
  Shield,
  ShoppingBag,
  Smartphone,
  Sparkles,
  Tv,
  Wifi,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import i18n from './i18n'

/** The icons a subscription or recurring item can wear. A brand uses its FontAwesome logo
 * (the free set has no Netflix, Disney or Claude: those get a generic icon instead, and
 * `keywords` still recognize them by name). `keywords` are lowercase, without accents, and
 * only ever used to match -- a brand's own name is its label, the generic ones are
 * translated (see `subscriptionIcons.generic` in the locales). */
interface IconDef {
  key: string
  brand?: IconDefinition
  generic?: LucideIcon
  label?: string
  keywords: string[]
}

const BRANDS: IconDef[] = [
  { key: 'spotify', brand: faSpotify, label: 'Spotify', keywords: ['spotify'] },
  { key: 'youtube', brand: faYoutube, label: 'YouTube', keywords: ['youtube'] },
  { key: 'amazon', brand: faAmazon, label: 'Amazon', keywords: ['amazon', 'prime video', 'prime'] },
  { key: 'google-drive', brand: faGoogleDrive, label: 'Google Drive', keywords: ['google drive'] },
  { key: 'google', brand: faGoogle, label: 'Google', keywords: ['google', 'gmail', 'google one'] },
  { key: 'apple', brand: faApple, label: 'Apple', keywords: ['apple', 'icloud', 'itunes'] },
  { key: 'microsoft', brand: faMicrosoft, label: 'Microsoft', keywords: ['microsoft', 'office', 'onedrive', 'outlook'] },
  { key: 'linkedin', brand: faLinkedin, label: 'LinkedIn', keywords: ['linkedin'] },
  { key: 'github', brand: faGithub, label: 'GitHub', keywords: ['github', 'copilot'] },
  { key: 'gitlab', brand: faGitlab, label: 'GitLab', keywords: ['gitlab'] },
  { key: 'dropbox', brand: faDropbox, label: 'Dropbox', keywords: ['dropbox'] },
  { key: 'paypal', brand: faPaypal, label: 'PayPal', keywords: ['paypal'] },
  { key: 'stripe', brand: faStripe, label: 'Stripe', keywords: ['stripe'] },
  { key: 'playstation', brand: faPlaystation, label: 'PlayStation', keywords: ['playstation', 'ps plus', 'psn'] },
  { key: 'xbox', brand: faXbox, label: 'Xbox', keywords: ['xbox', 'game pass'] },
  { key: 'steam', brand: faSteam, label: 'Steam', keywords: ['steam'] },
  { key: 'twitch', brand: faTwitch, label: 'Twitch', keywords: ['twitch'] },
  { key: 'discord', brand: faDiscord, label: 'Discord', keywords: ['discord'] },
  { key: 'slack', brand: faSlack, label: 'Slack', keywords: ['slack'] },
  { key: 'whatsapp', brand: faWhatsapp, label: 'WhatsApp', keywords: ['whatsapp'] },
  { key: 'telegram', brand: faTelegram, label: 'Telegram', keywords: ['telegram'] },
  { key: 'skype', brand: faSkype, label: 'Skype', keywords: ['skype'] },
  { key: 'uber', brand: faUber, label: 'Uber', keywords: ['uber'] },
  { key: 'airbnb', brand: faAirbnb, label: 'Airbnb', keywords: ['airbnb'] },
  { key: 'figma', brand: faFigma, label: 'Figma', keywords: ['figma'] },
  { key: 'docker', brand: faDocker, label: 'Docker', keywords: ['docker'] },
  { key: 'aws', brand: faAws, label: 'AWS', keywords: ['aws', 'amazon web services'] },
  { key: 'cloudflare', brand: faCloudflare, label: 'Cloudflare', keywords: ['cloudflare'] },
  { key: 'shopify', brand: faShopify, label: 'Shopify', keywords: ['shopify'] },
  { key: 'patreon', brand: faPatreon, label: 'Patreon', keywords: ['patreon'] },
  { key: 'deezer', brand: faDeezer, label: 'Deezer', keywords: ['deezer'] },
  { key: 'soundcloud', brand: faSoundcloud, label: 'SoundCloud', keywords: ['soundcloud'] },
  { key: 'wordpress', brand: faWordpress, label: 'WordPress', keywords: ['wordpress'] },
  { key: 'medium', brand: faMedium, label: 'Medium', keywords: ['medium'] },
  { key: 'vimeo', brand: faVimeo, label: 'Vimeo', keywords: ['vimeo'] },
  { key: 'android', brand: faAndroid, label: 'Android', keywords: ['android'] },
  { key: 'facebook', brand: faFacebook, label: 'Facebook', keywords: ['facebook', 'meta verified'] },
  { key: 'instagram', brand: faInstagram, label: 'Instagram', keywords: ['instagram'] },
  { key: 'tiktok', brand: faTiktok, label: 'TikTok', keywords: ['tiktok'] },
  { key: 'x', brand: faXTwitter, label: 'X', keywords: ['twitter', 'x premium'] },
  { key: 'reddit', brand: faReddit, label: 'Reddit', keywords: ['reddit'] },
  { key: 'bitcoin', brand: faBitcoin, label: 'Bitcoin', keywords: ['bitcoin', 'btc'] },
]

const GENERIC: IconDef[] = [
  { key: 'streaming', generic: Clapperboard, keywords: ['netflix', 'disney', 'hbo', 'max', 'paramount', 'vix', 'crunchyroll', 'streaming', 'cine'] },
  { key: 'tv', generic: Tv, keywords: ['television', 'tv', 'cable', 'sky', 'izzi', 'totalplay'] },
  { key: 'music', generic: Music, keywords: ['musica', 'music', 'tidal'] },
  { key: 'ai', generic: Sparkles, keywords: ['claude', 'chatgpt', 'openai', 'anthropic', 'gemini', 'midjourney', 'perplexity', 'ia'] },
  { key: 'server', generic: Server, keywords: ['hetzner', 'servidor', 'vps', 'hosting', 'dominio', 'digitalocean', 'vercel', 'server'] },
  { key: 'cloud', generic: Cloud, keywords: ['nube', 'cloud', 'almacenamiento', 'storage'] },
  { key: 'shopping', generic: ShoppingBag, keywords: ['mercado libre', 'meli', 'meli+', 'mercadolibre', 'tienda', 'membresia', 'coppel', 'liverpool'] },
  { key: 'insurance', generic: Shield, keywords: ['seguro', 'insurance', 'blindaje', 'proteccion'] },
  { key: 'phone', generic: Smartphone, keywords: ['celular', 'telcel', 'movistar', 'at&t', 'att', 'plan celular', 'telefono', 'recarga'] },
  { key: 'internet', generic: Wifi, keywords: ['internet', 'telmex', 'wifi', 'fibra'] },
  { key: 'electricity', generic: Zap, keywords: ['luz', 'cfe', 'electricidad', 'electric'] },
  { key: 'water', generic: Droplet, keywords: ['agua', 'water'] },
  { key: 'gas', generic: Flame, keywords: ['gas'] },
  { key: 'gym', generic: Dumbbell, keywords: ['gym', 'gimnasio', 'smartfit', 'crossfit', 'fitness'] },
  { key: 'health', generic: HeartPulse, keywords: ['salud', 'medico', 'dentista', 'terapia', 'psicologo', 'psiquiatra', 'health'] },
  { key: 'education', generic: GraduationCap, keywords: ['curso', 'escuela', 'colegiatura', 'duolingo', 'platzi', 'coursera', 'udemy', 'universidad'] },
  { key: 'books', generic: BookOpen, keywords: ['libro', 'kindle', 'audible', 'revista'] },
  { key: 'news', generic: Newspaper, keywords: ['periodico', 'noticias', 'news'] },
  { key: 'games', generic: Gamepad2, keywords: ['nintendo', 'videojuego', 'juego', 'epic games', 'gaming'] },
  { key: 'car', generic: Car, keywords: ['auto', 'carro', 'coche', 'didi', 'cabify', 'gasolina', 'estacionamiento', 'tenencia'] },
  { key: 'home', generic: Home, keywords: ['renta', 'alquiler', 'hipoteca', 'casa', 'mantenimiento'] },
  { key: 'design', generic: Palette, keywords: ['adobe', 'canva', 'diseno', 'photoshop'] },
  { key: 'podcast', generic: Headphones, keywords: ['podcast', 'audio'] },
  { key: 'photo', generic: Camera, keywords: ['foto', 'camara', 'photo'] },
  { key: 'web', generic: Globe, keywords: ['web', 'vpn', 'navegador'] },
  { key: 'security', generic: Lock, keywords: ['password', 'contrasena', '1password', 'bitwarden', 'lastpass', 'antivirus'] },
  { key: 'mail', generic: Mail, keywords: ['correo', 'email', 'mail', 'proton'] },
  { key: 'work', generic: Briefcase, keywords: ['trabajo', 'oficina', 'coworking', 'notion', 'trello', 'jira'] },
  { key: 'package', generic: Package, keywords: ['envio', 'paqueteria', 'caja', 'suscripcion box'] },
]

export const SUBSCRIPTION_ICONS: IconDef[] = [...BRANDS, ...GENERIC]
const BY_KEY = new Map(SUBSCRIPTION_ICONS.map((def) => [def.key, def]))

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

function mentions(haystack: string, keyword: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(haystack)
}

/** The icon that fits a name ("Spotify familiar" -> spotify), or null if nothing does. A whole
 * word has to match, so "gas" is found in "Gas natural" but not in "Gasolina". Brands come
 * first: "Amazon Prime" is Amazon before it is anything generic. */
export function suggestIcon(name: string): string | null {
  const text = normalize(name)
  if (!text.trim()) return null
  return SUBSCRIPTION_ICONS.find((def) => def.keywords.some((k) => mentions(text, k)))?.key ?? null
}

/** What to draw for an item: the icon it was given, else the one its name suggests. */
export function resolveIcon(icon: string | null | undefined, name: string): IconDef | null {
  if (icon && BY_KEY.has(icon)) return BY_KEY.get(icon)!
  const suggested = suggestIcon(name)
  return suggested ? BY_KEY.get(suggested)! : null
}

export function isKnownIcon(key: string | null | undefined): boolean {
  return !!key && BY_KEY.has(key)
}

export function iconLabel(def: IconDef): string {
  return def.label ?? i18n.t(`pages:subscriptionIcons.generic.${def.key}`, { defaultValue: def.key })
}

/** Search by label, key and synonyms, ignoring case and accents. */
export function matchesIcon(def: IconDef, query: string): boolean {
  const q = normalize(query.trim())
  if (!q) return true
  return normalize([def.key, iconLabel(def), ...def.keywords].join(' ')).includes(q)
}

export type { IconDef }
