import { useId } from 'react'

export interface Point {
  x: number
  y: number
}

/** Catmull-Rom -> Bezier: curva suave que pasa exactamente por cada punto. */
export function smoothPath(points: Point[]): string {
  if (points.length === 0) return ''
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`
  let d = `M ${points[0].x} ${points[0].y}`
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[i + 2] ?? p2
    const cp1x = p1.x + (p2.x - p0.x) / 6
    const cp1y = p1.y + (p2.y - p0.y) / 6
    const cp2x = p2.x - (p3.x - p1.x) / 6
    const cp2y = p2.y - (p3.y - p1.y) / 6
    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`
  }
  return d
}

/** Fondo de puntos decorativo usado detras de los line charts en el diseno. */
export function DotGrid({ x, y, width, height }: { x: number; y: number; width: number; height: number }) {
  const id = useId().replace(/:/g, '')
  return (
    <>
      <defs>
        <pattern id={id} width="34" height="38" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="1.1" fill="var(--nl-bg-track)" />
        </pattern>
      </defs>
      <rect x={x} y={y} width={width} height={height} fill={`url(#${id})`} />
    </>
  )
}

export function LineChart({
  series,
  width = 800,
  height = 220,
  color = 'var(--nl-accent)',
  xLabels,
  padding = { top: 20, right: 20, bottom: 26, left: 20 },
}: {
  series: number[]
  width?: number
  height?: number
  color?: string
  xLabels?: string[]
  padding?: { top: number; right: number; bottom: number; left: number }
}) {
  if (series.length === 0) return null
  const min = Math.min(...series)
  const max = Math.max(...series)
  const span = max - min || 1
  const plotW = width - padding.left - padding.right
  const plotH = height - padding.top - padding.bottom
  const points: Point[] = series.map((v, i) => ({
    x: padding.left + (i / Math.max(1, series.length - 1)) * plotW,
    y: padding.top + plotH - ((v - min) / span) * plotH,
  }))

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" style={{ display: 'block' }}>
      <DotGrid x={padding.left} y={padding.top} width={plotW} height={plotH} />
      <path d={smoothPath(points)} fill="none" stroke={color} strokeWidth={2} />
      {xLabels?.map((label, i) => (
        <text
          key={i}
          x={points[i]?.x}
          y={height - 6}
          textAnchor="middle"
          fontSize={10}
          fill="var(--nl-text-secondary)"
        >
          {label}
        </text>
      ))}
    </svg>
  )
}

export function Sparkline({
  series,
  width = 50,
  height = 16,
  color = 'var(--nl-accent)',
}: {
  series: number[]
  width?: number
  height?: number
  color?: string
}) {
  if (series.length < 2) return <svg width={width} height={height} />
  const min = Math.min(...series)
  const max = Math.max(...series)
  const span = max - min || 1
  const points: Point[] = series.map((v, i) => ({
    x: (i / (series.length - 1)) * width,
    y: height - ((v - min) / span) * height,
  }))
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <path d={smoothPath(points)} fill="none" stroke={color} strokeWidth={1.3} />
    </svg>
  )
}

export function GroupedBars({
  groups,
  width = 700,
  height = 160,
  colorA = 'var(--nl-accent)',
  colorB = 'var(--nl-danger)',
  padding = { top: 10, bottom: 24 },
}: {
  groups: { label: string; a: number; b: number }[]
  width?: number
  height?: number
  colorA?: string
  colorB?: string
  padding?: { top: number; bottom: number }
}) {
  if (groups.length === 0) return null
  const max = Math.max(1, ...groups.flatMap((g) => [g.a, g.b]))
  const plotH = height - padding.top - padding.bottom
  const slot = width / groups.length
  const barW = Math.min(20, slot * 0.28)

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" style={{ display: 'block' }}>
      <DotGrid x={0} y={padding.top} width={width} height={plotH} />
      {groups.map((g, i) => {
        const cx = slot * i + slot / 2
        const hA = (g.a / max) * plotH
        const hB = (g.b / max) * plotH
        return (
          <g key={i}>
            <rect
              x={cx - barW - 2}
              y={padding.top + plotH - hA}
              width={barW}
              height={hA}
              rx={2}
              fill={colorA}
            />
            <rect x={cx + 2} y={padding.top + plotH - hB} width={barW} height={hB} rx={2} fill={colorB} />
            <text x={cx} y={height - 6} textAnchor="middle" fontSize={10} fill="var(--nl-text-secondary)">
              {g.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

export function SimpleBars({
  bars,
  width = 700,
  height = 160,
  color = 'var(--nl-accent)',
  showValues = false,
  formatValue,
  padding = { top: 20, bottom: 24 },
}: {
  bars: { label: string; value: number; color?: string }[]
  width?: number
  height?: number
  color?: string
  showValues?: boolean
  formatValue?: (v: number) => string
  padding?: { top: number; bottom: number }
}) {
  if (bars.length === 0) return null
  const max = Math.max(1, ...bars.map((b) => b.value))
  const plotH = height - padding.top - padding.bottom
  const slot = width / bars.length
  const barW = Math.min(46, slot * 0.6)

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" style={{ display: 'block' }}>
      <DotGrid x={0} y={padding.top} width={width} height={plotH} />
      {bars.map((b, i) => {
        const cx = slot * i + slot / 2
        const h = (b.value / max) * plotH
        return (
          <g key={i}>
            {showValues && (
              <text
                x={cx}
                y={padding.top + plotH - h - 6}
                textAnchor="middle"
                fontSize={10}
                fill="var(--nl-text-secondary)"
              >
                {formatValue ? formatValue(b.value) : b.value}
              </text>
            )}
            <rect
              x={cx - barW / 2}
              y={padding.top + plotH - h}
              width={barW}
              height={h}
              rx={2}
              fill={b.color ?? color}
            />
            <text x={cx} y={height - 6} textAnchor="middle" fontSize={10} fill="var(--nl-text-secondary)">
              {b.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

export function StackedBars({
  groups,
  width = 500,
  height = 200,
  colors,
  padding = { top: 10, bottom: 24 },
}: {
  groups: { label: string; values: number[] }[]
  width?: number
  height?: number
  colors: string[]
  padding?: { top: number; bottom: number }
}) {
  if (groups.length === 0) return null
  const totals = groups.map((g) => g.values.reduce((a, b) => a + b, 0))
  const max = Math.max(1, ...totals)
  const plotH = height - padding.top - padding.bottom
  const slot = width / groups.length
  const barW = Math.min(46, slot * 0.6)

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" style={{ display: 'block' }}>
      <DotGrid x={0} y={padding.top} width={width} height={plotH} />
      {groups.map((g, i) => {
        const cx = slot * i + slot / 2
        let cursor = padding.top + plotH
        return (
          <g key={i}>
            {g.values.map((v, vi) => {
              const h = (v / max) * plotH
              cursor -= h
              return <rect key={vi} x={cx - barW / 2} y={cursor} width={barW} height={h} fill={colors[vi]} />
            })}
            <text x={cx} y={height - 6} textAnchor="middle" fontSize={10} fill="var(--nl-text-secondary)">
              {g.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

export function RadarChart({
  axes,
  size = 280,
  color = 'var(--nl-accent)',
  rings = 4,
}: {
  axes: { label: string; value: number }[]
  size?: number
  color?: string
  rings?: number
}) {
  if (axes.length < 3) return null
  const center = size / 2
  const labelPad = 40
  const r = center - labelPad
  const max = Math.max(1, ...axes.map((a) => a.value))
  const angleFor = (i: number) => -Math.PI / 2 + (i / axes.length) * 2 * Math.PI
  const pointAt = (i: number, ratio: number) => {
    const angle = angleFor(i)
    return { x: center + Math.cos(angle) * r * ratio, y: center + Math.sin(angle) * r * ratio }
  }
  const dataPoints = axes.map((a, i) => pointAt(i, a.value / max))
  const dataPath = dataPoints.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')

  return (
    <svg viewBox={`0 0 ${size} ${size}`} width="100%" style={{ display: 'block', maxWidth: size }}>
      {Array.from({ length: rings }, (_, ringIndex) => {
        const ratio = (ringIndex + 1) / rings
        const ringPoints = axes.map((_, i) => pointAt(i, ratio))
        return (
          <polygon
            key={ringIndex}
            points={ringPoints.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
            fill="none"
            stroke="var(--nl-border)"
            strokeWidth={1}
          />
        )
      })}
      {axes.map((_, i) => {
        const p = pointAt(i, 1)
        return (
          <line key={i} x1={center} y1={center} x2={p.x} y2={p.y} stroke="var(--nl-border)" strokeWidth={1} />
        )
      })}
      <polygon points={dataPath} fill={color} fillOpacity={0.18} stroke={color} strokeWidth={2} />
      {dataPoints.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={2.5} fill={color} />
      ))}
      {axes.map((a, i) => {
        const p = pointAt(i, 1.16)
        // Ancla el texto segun el lado del radar en el que cae la etiqueta
        // -- "middle" (arriba/abajo) centra bien, pero para etiquetas casi
        // horizontales (derecha/izquierda) centrar hace que la mitad del
        // texto se salga del viewBox. "start"/"end" lo estira hacia el
        // margen disponible en vez de hacia el centro del chart.
        const cos = Math.cos(angleFor(i))
        const anchor = cos > 0.3 ? 'start' : cos < -0.3 ? 'end' : 'middle'
        return (
          <text
            key={i}
            x={p.x}
            y={p.y}
            textAnchor={anchor}
            dominantBaseline="middle"
            fontSize={10}
            fill="var(--nl-text-secondary)"
          >
            {a.label.length > 16 ? `${a.label.slice(0, 15)}…` : a.label}
          </text>
        )
      })}
    </svg>
  )
}

export function Donut({
  slices,
  size = 180,
  strokeWidth = 30,
  centerLabel,
  centerSub,
}: {
  slices: { value: number; color: string }[]
  size?: number
  strokeWidth?: number
  centerLabel?: string
  centerSub?: string
}) {
  const r = (size - strokeWidth) / 2
  const c = 2 * Math.PI * r
  const total = slices.reduce((sum, s) => sum + s.value, 0) || 1
  let cumulative = 0
  const center = size / 2

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={center} cy={center} r={r} fill="none" stroke="var(--nl-bg-track)" strokeWidth={strokeWidth} />
      {slices.map((s, i) => {
        const dash = (s.value / total) * c
        const offset = -((cumulative / total) * c)
        cumulative += s.value
        return (
          <circle
            key={i}
            cx={center}
            cy={center}
            r={r}
            fill="none"
            stroke={s.color}
            strokeWidth={strokeWidth}
            strokeDasharray={`${dash.toFixed(1)} ${(c - dash).toFixed(1)}`}
            strokeDashoffset={offset.toFixed(1)}
            transform={`rotate(-90 ${center} ${center})`}
          />
        )
      })}
      {centerLabel && (
        <text x={center} y={center - 2} textAnchor="middle" fontSize={18} fontWeight={300} fill="var(--nl-text-primary)">
          {centerLabel}
        </text>
      )}
      {centerSub && (
        <text x={center} y={center + 16} textAnchor="middle" fontSize={10} fill="var(--nl-text-secondary)">
          {centerSub}
        </text>
      )}
    </svg>
  )
}
