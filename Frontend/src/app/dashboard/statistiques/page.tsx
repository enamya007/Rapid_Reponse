'use client'

import { useMemo, useState } from 'react'
import { Table } from 'lucide-react'
import StatCard from '@/features/dashboard/components/StatCard'
import RequireRole from '@/components/RequireRole'
import { useTickets } from '@/hooks/useTickets'
import { useTechnicians } from '@/hooks/useTechnicians'
import type { TicketListItem, TicketStatus } from '@/types/ticket'
import type { Technician } from '@/types/technician'

type Period = '7 jours' | '30 jours' | 'Tout'

const statusLabels: Record<TicketStatus, string> = {
    OPEN: 'Ouvert',
    ASSIGNED: 'Affecté',
    IN_PROGRESS: 'En cours',
    RESOLVED: 'Résolu',
    CLOSED: 'Fermé',
    CANCELLED: 'Annulé',
}

const statusColors: Record<TicketStatus, string> = {
    OPEN: '#7B337E',
    ASSIGNED: '#420D4B',
    IN_PROGRESS: '#6667AB',
    RESOLVED: '#2e9e6b',
    CLOSED: '#64748b',
    CANCELLED: '#d24b6a',
}

const statusOrder: TicketStatus[] = [
    'OPEN',
    'ASSIGNED',
    'IN_PROGRESS',
    'RESOLVED',
    'CLOSED',
    'CANCELLED',
]

function daysAgo(n: number) {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() - n)
    return d
}

function inPeriod(iso: string, period: Period) {
    if (period === 'Tout') return true
    const created = new Date(iso)
    const from = period === '7 jours' ? daysAgo(6) : daysAgo(29)
    return created >= from
}

function displayName(tech: Technician) {
    const full = [tech.firstName, tech.lastName].filter(Boolean).join(' ').trim()
    return full || tech.username
}

function DonutChart({
    slices,
    hovered,
    onHoverChange,
}: {
    slices: { label: string; value: number; color: string }[]
    hovered: string | null
    onHoverChange: (label: string | null) => void
}) {
    const total = slices.reduce((sum, s) => sum + s.value, 0)
    const radius = 70
    const circumference = 2 * Math.PI * radius

    const segments = slices.map((s, index) => {
        const dash = total === 0 ? 0 : (s.value / total) * circumference
        const offset = slices
            .slice(0, index)
            .reduce(
                (sum, prev) =>
                    sum + (total === 0 ? 0 : (prev.value / total) * circumference),
                0,
            )
        return { ...s, dash, offset }
    })

    if (total === 0) {
        return (
            <svg viewBox="0 0 180 180" className="h-44 w-44">
                <circle
                    cx="90"
                    cy="90"
                    r={radius}
                    fill="none"
                    stroke="#210635"
                    strokeOpacity="0.08"
                    strokeWidth="24"
                />
            </svg>
        )
    }

    const active = hovered ? (segments.find((s) => s.label === hovered) ?? null) : null
    const centerValue = active ? active.value : total
    const centerCaption = active
        ? `${active.label} · ${Math.round((active.value / total) * 100)}%`
        : `ticket${total > 1 ? 's' : ''} au total`

    return (
        <svg viewBox="0 0 180 180" className="h-44 w-44">
            {segments.map((s) => {
                const isHovered = hovered === s.label
                return (
                    <circle
                        key={s.label}
                        cx="90"
                        cy="90"
                        r={radius}
                        fill="none"
                        stroke={s.color}
                        strokeWidth={isHovered ? 28 : 24}
                        strokeOpacity={hovered && !isHovered ? 0.45 : 1}
                        strokeDasharray={`${Math.max(s.dash - 3, 0)} ${circumference - s.dash + 3}`}
                        strokeDashoffset={-s.offset}
                        transform="rotate(-90 90 90)"
                        tabIndex={0}
                        aria-label={`${s.label} : ${s.value} ticket${s.value > 1 ? 's' : ''}`}
                        className="cursor-pointer outline-none transition-[stroke-width,stroke-opacity]"
                        onPointerEnter={() => onHoverChange(s.label)}
                        onPointerLeave={() => onHoverChange(null)}
                        onFocus={() => onHoverChange(s.label)}
                        onBlur={() => onHoverChange(null)}
                    />
                )
            })}
            <text
                x="90"
                y="86"
                textAnchor="middle"
                fontSize="22"
                fontWeight="700"
                fill="#210635"
                pointerEvents="none"
            >
                {centerValue}
            </text>
            <text x="90" y="102" textAnchor="middle" fontSize="8.5" fill="#21063580" pointerEvents="none">
                {centerCaption}
            </text>
        </svg>
    )
}

function TrendChart({ points }: { points: { day: string; value: number }[] }) {
    const [hoverIndex, setHoverIndex] = useState<number | null>(null)
    const width = 460
    const height = 170
    const padX = 30
    const padY = 16
    const max = Math.max(1, ...points.map((p) => p.value))

    if (points.length === 0) {
        return <p className="py-10 text-center text-sm text-moon-abyss/65">Aucune donnée</p>
    }

    const coords = points.map((p, i) => ({
        x:
            points.length === 1
                ? width / 2
                : padX + (i * (width - padX * 2)) / (points.length - 1),
        y: height - padY - (p.value / max) * (height - padY * 2),
    }))

    const path = coords
        .map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`))
        .join(' ')

    const area = `${path} L ${coords[coords.length - 1].x} ${height - padY} L ${coords[0].x} ${height - padY} Z`
    const gridMax = Math.max(4, Math.ceil(max))
    const ticks = Array.from({ length: 5 }, (_, i) => Math.round((gridMax * i) / 4))

    const nearestIndex = (localX: number) => {
        let best = 0
        let bestDist = Infinity
        coords.forEach((c, i) => {
            const d = Math.abs(c.x - localX)
            if (d < bestDist) {
                bestDist = d
                best = i
            }
        })
        return best
    }

    const hoveredPoint = hoverIndex != null ? points[hoverIndex] : null
    const hoveredCoord = hoverIndex != null ? coords[hoverIndex] : null
    const tipWidth = 76
    const tipHeight = 38
    const tipX = hoveredCoord
        ? Math.min(Math.max(hoveredCoord.x - tipWidth / 2, padX), width - padX - tipWidth)
        : 0
    const tipBelow = hoveredCoord ? hoveredCoord.y - tipHeight - 12 < 0 : false
    const tipY = hoveredCoord
        ? tipBelow
            ? hoveredCoord.y + 12
            : hoveredCoord.y - tipHeight - 10
        : 0

    return (
        <svg viewBox={`0 0 ${width} ${height + 20}`} className="w-full">
            <defs>
                <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6667AB" stopOpacity="0.25" />
                    <stop offset="100%" stopColor="#6667AB" stopOpacity="0" />
                </linearGradient>
            </defs>

            {ticks.map((v) => {
                const y = height - padY - (v / gridMax) * (height - padY * 2)

                return (
                    <g key={v}>
                        <line
                            x1={padX}
                            y1={y}
                            x2={width - padX}
                            y2={y}
                            stroke="#210635"
                            strokeOpacity="0.06"
                        />
                        <text x={padX - 8} y={y + 3} textAnchor="end" fontSize="9" fill="#21063580">
                            {v}
                        </text>
                    </g>
                )
            })}

            <path d={area} fill="url(#trendFill)" />
            <path d={path} fill="none" stroke="#6667AB" strokeWidth="2.5" strokeLinejoin="round" />

            {hoveredCoord && (
                <line
                    x1={hoveredCoord.x}
                    y1={padY}
                    x2={hoveredCoord.x}
                    y2={height - padY}
                    stroke="#210635"
                    strokeOpacity="0.2"
                    strokeDasharray="3 3"
                    pointerEvents="none"
                />
            )}

            {coords.map((p, i) => (
                <g key={`${points[i].day}-${i}`}>
                    <circle
                        cx={p.x}
                        cy={p.y}
                        r={hoverIndex === i ? 6 : 4}
                        fill="#6667AB"
                        stroke="#fff"
                        strokeWidth="1.5"
                        pointerEvents="none"
                        className="transition-[r]"
                    />
                    {(points.length <= 8 || i % Math.ceil(points.length / 7) === 0) && (
                        <text x={p.x} y={height + 12} textAnchor="middle" fontSize="9" fill="#21063580">
                            {points[i].day}
                        </text>
                    )}
                    <circle
                        cx={p.x}
                        cy={p.y}
                        r="12"
                        fill="transparent"
                        tabIndex={0}
                        aria-label={`${points[i].day} : ${points[i].value} ticket${points[i].value > 1 ? 's' : ''}`}
                        className="cursor-pointer outline-none"
                        onFocus={() => setHoverIndex(i)}
                        onBlur={() => setHoverIndex((h) => (h === i ? null : h))}
                    />
                </g>
            ))}

            <rect
                x={padX}
                y={0}
                width={Math.max(width - padX * 2, 1)}
                height={height}
                fill="transparent"
                className="cursor-crosshair"
                onPointerMove={(e) => {
                    const svg = e.currentTarget.ownerSVGElement
                    if (!svg) return
                    const rect = svg.getBoundingClientRect()
                    const localX = ((e.clientX - rect.left) / rect.width) * width
                    setHoverIndex(nearestIndex(localX))
                }}
                onPointerLeave={() => setHoverIndex(null)}
            />

            {hoveredCoord && hoveredPoint && (
                <g pointerEvents="none">
                    <rect x={tipX} y={tipY} width={tipWidth} height={tipHeight} rx="6" fill="#210635" />
                    <text
                        x={tipX + tipWidth / 2}
                        y={tipY + 17}
                        textAnchor="middle"
                        fontSize="14"
                        fontWeight="700"
                        fill="#fff"
                    >
                        {hoveredPoint.value}
                    </text>
                    <text
                        x={tipX + tipWidth / 2}
                        y={tipY + 30}
                        textAnchor="middle"
                        fontSize="9"
                        fill="#ffffffb3"
                    >
                        {hoveredPoint.day}
                    </text>
                </g>
            )}
        </svg>
    )
}

function buildTrend(tickets: TicketListItem[], period: Period) {
    const dayCount = period === '30 jours' ? 30 : 7
    const start = daysAgo(dayCount - 1)
    const buckets = Array.from({ length: dayCount }, (_, i) => {
        const d = new Date(start)
        d.setDate(start.getDate() + i)
        return {
            key: d.toISOString().slice(0, 10),
            day: d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }),
            value: 0,
        }
    })
    const index = new Map(buckets.map((b) => [b.key, b]))

    for (const t of tickets) {
        const key = new Date(t.createdAt).toISOString().slice(0, 10)
        const bucket = index.get(key)
        if (bucket) bucket.value += 1
    }

    return buckets
}

function exportCsv(tickets: TicketListItem[]) {
    const header = ['reference', 'title', 'status', 'priority', 'category', 'createdAt']
    const rows = tickets.map((t) =>
        [
            t.reference,
            `"${t.title.replace(/"/g, '""')}"`,
            t.status,
            t.priority,
            `"${t.category.name.replace(/"/g, '""')}"`,
            t.createdAt,
        ].join(','),
    )
    const blob = new Blob([[header.join(','), ...rows].join('\n')], {
        type: 'text/csv;charset=utf-8;',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'tickets.csv'
    a.click()
    URL.revokeObjectURL(url)
}

function StatisticsPageContent() {
    const [period, setPeriod] = useState<Period>('7 jours')
    const [hoveredStatus, setHoveredStatus] = useState<string | null>(null)
    const ticketsQuery = useTickets({ page: 1, limit: 100 })
    const techniciansQuery = useTechnicians({ page: 1, limit: 100 })

    const tickets = useMemo(
        () => ticketsQuery.data?.data ?? [],
        [ticketsQuery.data?.data],
    )
    const technicians = techniciansQuery.data?.data ?? []

    const filtered = useMemo(
        () => tickets.filter((t) => inPeriod(t.createdAt, period)),
        [tickets, period],
    )

    const total = filtered.length
    const inProgress = filtered.filter((t) => t.status === 'IN_PROGRESS').length
    const resolved = filtered.filter((t) => t.status === 'RESOLVED').length
    const urgent = filtered.filter(
        (t) => t.priority === 'CRITICAL' && t.status !== 'RESOLVED' && t.status !== 'CLOSED',
    ).length

    const statusBreakdown = statusOrder.map((status) => ({
        label: statusLabels[status],
        value: filtered.filter((t) => t.status === status).length,
        color: statusColors[status],
    }))

    const trend = useMemo(() => buildTrend(tickets, period === 'Tout' ? '7 jours' : period), [tickets, period])

    return (
        <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold text-moon-abyss">Statistiques détaillées</h1>
                    <p className="mt-0.5 text-sm text-moon-abyss/70">
                        Calculées à partir des tickets et techniciens de l&apos;API
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <div className="flex rounded-full bg-moon-rose/40 p-1">
                        {(['7 jours', '30 jours', 'Tout'] as Period[]).map((p) => (
                            <button
                                key={p}
                                type="button"
                                onClick={() => setPeriod(p)}
                                className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                                    period === p
                                        ? 'bg-moon-violet-dark text-white'
                                        : 'text-moon-abyss/60 hover:text-moon-abyss'
                                }`}
                            >
                                {p}
                            </button>
                        ))}
                    </div>
                    <button
                        type="button"
                        onClick={() => exportCsv(filtered)}
                        disabled={filtered.length === 0}
                        className="flex items-center gap-2 rounded-lg border border-moon-violet-dark/30 bg-white px-4 py-2 text-sm font-medium text-moon-violet-dark hover:bg-moon-rose/20 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        <Table size={15} />
                        Exporter CSV
                    </button>
                </div>
            </div>

            {(ticketsQuery.isError || techniciansQuery.isError) && (
                <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
                    Impossible de charger une partie des données. Vérifiez la session et l’API.
                </p>
            )}

            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <StatCard
                    value={ticketsQuery.isLoading ? '…' : total}
                    label="Total tickets"
                    sublabel={period}
                    tone="plum"
                />
                <StatCard
                    value={ticketsQuery.isLoading ? '…' : inProgress}
                    label="En cours"
                    sublabel={`${urgent} urgent${urgent > 1 ? 's' : ''}`}
                    tone="lavande"
                />
                <StatCard
                    value={ticketsQuery.isLoading ? '…' : resolved}
                    label="Résolus"
                    sublabel={period}
                    tone="green"
                />
                <StatCard
                    value={ticketsQuery.isLoading ? '…' : urgent}
                    label="Urgents"
                    sublabel="priorité critique"
                    tone="rose"
                />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-2xl border border-moon-abyss/15 bg-white p-5 shadow-sm">
                    <h2 className="font-bold text-moon-violet-dark">Répartition par statut</h2>
                    <p className="text-xs text-moon-abyss/70">Tickets de la période</p>
                    <div className="mt-4 flex items-center gap-6">
                        <DonutChart
                            slices={statusBreakdown}
                            hovered={hoveredStatus}
                            onHoverChange={setHoveredStatus}
                        />
                        <ul className="flex-1 space-y-1">
                            {statusBreakdown.map((s) => (
                                <li
                                    key={s.label}
                                    tabIndex={0}
                                    onMouseEnter={() => setHoveredStatus(s.label)}
                                    onMouseLeave={() => setHoveredStatus(null)}
                                    onFocus={() => setHoveredStatus(s.label)}
                                    onBlur={() => setHoveredStatus(null)}
                                    className={`flex cursor-default items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-sm outline-none transition-colors ${
                                        hoveredStatus === s.label ? 'bg-moon-rose/25' : ''
                                    }`}
                                >
                                    <span
                                        className="h-2.5 w-2.5 rounded-full"
                                        style={{ backgroundColor: s.color }}
                                    />
                                    <span className="flex-1 text-moon-abyss/70">{s.label}</span>
                                    <span className="font-bold text-moon-abyss">{s.value}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>

                <div className="rounded-2xl border border-moon-abyss/15 bg-white p-5 shadow-sm">
                    <h2 className="font-bold text-moon-violet-dark">Évolution temporelle</h2>
                    <p className="text-xs text-moon-abyss/70">Tickets créés par jour</p>
                    <div className="mt-4">
                        <TrendChart points={trend} />
                    </div>
                </div>
            </div>

            <div className="rounded-2xl border border-moon-abyss/15 bg-white p-5 shadow-sm">
                <h2 className="font-bold text-moon-violet-dark">Charge comparée par technicien</h2>
                <p className="text-xs text-moon-abyss/70">Tickets actifs / capacité max</p>
                {techniciansQuery.isLoading && (
                    <p className="mt-4 text-sm text-moon-abyss/70">Chargement…</p>
                )}
                {!techniciansQuery.isLoading && technicians.length === 0 && (
                    <p className="mt-4 text-sm text-moon-abyss/70">Aucun technicien.</p>
                )}
                <div className="mt-5 space-y-4">
                    {technicians.map((t) => {
                        const name = displayName(t)
                        const cap = t.maxConcurrentTickets || 1
                        const pct = Math.min(100, Math.round((t.currentLoad / cap) * 100))

                        return (
                            <div key={t.id} className="flex items-center gap-4">
                                <span className="w-32 shrink-0 truncate text-right text-sm font-medium text-moon-abyss/70">
                                    {name}
                                </span>
                                <div className="h-3.5 flex-1 overflow-hidden rounded-full bg-moon-rose/30">
                                    <div
                                        className="h-full rounded-full bg-moon-violet-dark"
                                        style={{ width: `${pct}%` }}
                                    />
                                </div>
                                <span className="w-14 text-right text-sm font-bold text-moon-abyss">
                                    {t.currentLoad}/{cap}
                                </span>
                            </div>
                        )
                    })}
                </div>
            </div>
        </div>
    )
}

export default function StatisticsPage() {
    return (
        <RequireRole roles={['ADMIN']}>
            <StatisticsPageContent />
        </RequireRole>
    )
}
