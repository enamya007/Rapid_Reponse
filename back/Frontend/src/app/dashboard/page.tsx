'use client'

import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { ArrowRight } from 'lucide-react'
import StatCard from '@/features/dashboard/components/StatCard'
import { useTickets } from '@/hooks/useTickets'
import { useTechnician, useTechnicians, useUpdateMyAvailability } from '@/hooks/useTechnicians'
import { statusLabels, statusStyles } from '@/features/tickets/ticketUi'

export default function DashboardHomePage() {
    const { data: session } = useSession()
    const role = session?.user?.role
    const isAdmin = role === 'ADMIN'
    const isTechnician = role === 'TECHNICIAN'

    const ticketsQuery = useTickets({ page: 1, limit: 20 })
    const techniciansQuery = useTechnicians(
        { page: 1, limit: 50, isAvailable: true },
        { enabled: isAdmin },
    )
    const myProfileQuery = useTechnician(session?.user?.id ?? '', {
        enabled: isTechnician && Boolean(session?.user?.id),
    })
    const updateAvailability = useUpdateMyAvailability()

    const tickets = ticketsQuery.data?.data ?? []
    const technicians = techniciansQuery.data?.data ?? []

    const open = tickets.filter((t) => t.status === 'OPEN').length
    const assigned = tickets.filter((t) => t.status === 'ASSIGNED').length
    const inProgress = tickets.filter((t) => t.status === 'IN_PROGRESS').length
    const urgent = tickets.filter(
        (t) => t.priority === 'CRITICAL' && t.status !== 'RESOLVED' && t.status !== 'CLOSED' && t.status !== 'CANCELLED',
    ).length
    const recent = tickets.slice(0, 5)

    const subtitle = isTechnician
        ? 'Tickets qui vous sont affectés'
        : isAdmin
          ? "Vue d'ensemble de l'activité"
          : 'Historique des tickets que vous avez créés'

    const fourthKpi = isAdmin
        ? { value: technicians.length, label: 'Techniciens disponibles' }
        : isTechnician
          ? {
                value: myProfileQuery.data
                    ? `${myProfileQuery.data.currentLoad}/${myProfileQuery.data.maxConcurrentTickets}`
                    : assigned,
                label: myProfileQuery.data ? 'Charge actuelle' : 'En attente de prise en charge',
            }
          : { value: tickets.filter((t) => t.status === 'RESOLVED').length, label: 'Résolus' }

    return (
        <div className="space-y-5">
            <div>
                <h1 className="text-2xl font-bold text-moon-abyss">Tableau de bord</h1>
                <p className="mt-0.5 text-sm text-moon-abyss/70">{subtitle}</p>
            </div>

            {ticketsQuery.isError && (
                <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
                    Impossible de charger les tickets. Vérifiez que vous êtes connecté et que l’API
                    tourne.
                </p>
            )}

            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <StatCard value={open} label="Tickets ouverts" tone="rose" />
                <StatCard value={inProgress} label="En cours" tone="violet" />
                <StatCard value={urgent} label="Urgents" tone="plum" />
                <StatCard value={fourthKpi.value} label={fourthKpi.label} tone="green" />
            </div>

            {isTechnician && myProfileQuery.data && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-moon-abyss/15 bg-white p-4 shadow-sm">
                    <div>
                        <p className="text-sm font-semibold text-moon-abyss">Ma disponibilité</p>
                        <p className="text-xs text-moon-abyss/70">
                            Cliquez pour indiquer si vous pouvez recevoir de nouveaux tickets.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() =>
                            updateAvailability.mutate({
                                isAvailable: !myProfileQuery.data.isAvailable,
                            })
                        }
                        disabled={updateAvailability.isPending}
                        className={`rounded-full px-4 py-2 text-sm font-semibold ${
                            myProfileQuery.data.isAvailable
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-moon-abyss/8 text-moon-abyss/60'
                        }`}
                    >
                        {updateAvailability.isPending
                            ? 'Mise à jour…'
                            : myProfileQuery.data.isAvailable
                              ? 'Disponible'
                              : 'Indisponible'}
                    </button>
                </div>
            )}

            <div className="rounded-2xl border border-moon-abyss/15 bg-white p-5 shadow-sm">
                <div className="mb-4 flex items-center justify-between">
                    <div>
                        <h2 className="font-bold text-moon-violet-dark">
                            {isTechnician ? 'Derniers tickets affectés' : 'Derniers tickets'}
                        </h2>
                        <p className="text-xs text-moon-abyss/70">Les 5 plus récents</p>
                    </div>
                    <Link
                        href="/dashboard/tickets"
                        className="flex items-center gap-1.5 text-sm font-medium text-moon-violet hover:text-moon-violet-dark"
                    >
                        Tout voir
                        <ArrowRight size={14} />
                    </Link>
                </div>
                {ticketsQuery.isLoading && (
                    <p className="text-sm text-moon-abyss/70">Chargement…</p>
                )}
                {!ticketsQuery.isLoading && recent.length === 0 && (
                    <p className="text-sm text-moon-abyss/70">Aucun ticket pour le moment.</p>
                )}
                <ul className="divide-y divide-moon-abyss/5">
                    {recent.map((t) => (
                        <li key={t.id}>
                            <Link
                                href={`/dashboard/tickets/${t.id}`}
                                className="flex items-center gap-4 py-3 transition-colors hover:bg-moon-rose/10"
                            >
                                <span className="w-20 shrink-0 font-mono text-xs text-moon-abyss/65">
                                    {t.reference}
                                </span>
                                <span className="flex-1 truncate text-sm font-medium text-moon-abyss">
                                    {t.title}
                                </span>
                                <span className="hidden text-sm text-moon-abyss/70 sm:block">
                                    {t.category.name}
                                </span>
                                <span
                                    className={`shrink-0 rounded-md px-2 py-1 text-[11px] font-bold ${statusStyles[t.status]}`}
                                >
                                    {statusLabels[t.status]}
                                </span>
                            </Link>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    )
}
