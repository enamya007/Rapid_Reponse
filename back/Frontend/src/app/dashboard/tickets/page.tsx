'use client'

import { Suspense, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { Search, Filter, Plus, ArrowRight, List, LayoutGrid } from 'lucide-react'
import StatCard from '@/features/dashboard/components/StatCard'
import Modal from '@/features/dashboard/components/Modal'
import AssignTicketModal from '@/features/tickets/AssignTicketModal'
import RequiredMark from '@/components/RequiredMark'
import {
    TICKET_TITLE_MIN_LENGTH,
    TICKET_TITLE_MAX_LENGTH,
    SITE_LABEL_MIN_LENGTH,
    SITE_LABEL_MAX_LENGTH,
    DESCRIPTION_MAX_LENGTH,
    requiredFieldMessage,
} from '@/lib/validators'
import { useTickets, useCreateTicket } from '@/hooks/useTickets'
import { useTechnicians } from '@/hooks/useTechnicians'
import { useCategories } from '@/hooks/useCategories'
import type { TicketListItem, TicketPriority, TicketStatus } from '@/types/ticket'
import type { Technician } from '@/types/technician'
import {
    canAssignStatus,
    displayPersonName,
    formatDate,
    initialsOf,
    priorityDots,
    priorityLabels,
    statusLabels,
    statusStyles,
    ticketFieldClass,
    ticketLabelClass,
} from '@/features/tickets/ticketUi'

function TicketsContent() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const { data: session } = useSession()
    const role = session?.user?.role
    const isAdmin = role === 'ADMIN'
    const isTechnician = role === 'TECHNICIAN'
    const canCreate = role === 'ADMIN' || role === 'CLIENT'

    const urlQuery = searchParams.get('q') ?? ''
    const [query, setQuery] = useState(urlQuery)
    const [syncedUrlQuery, setSyncedUrlQuery] = useState(urlQuery)
    const [status, setStatus] = useState<'Tous' | TicketStatus>('Tous')
    const [priority, setPriority] = useState<'Toutes' | TicketPriority>('Toutes')
    const [technicianFilter, setTechnicianFilter] = useState('Tous')
    const [viewMode, setViewMode] = useState<'list' | 'grid'>('list')

    if (urlQuery !== syncedUrlQuery) {
        setSyncedUrlQuery(urlQuery)
        setQuery(urlQuery)
    }

    const listQuery = useMemo(
        () => ({
            page: 1,
            limit: 100,
            q: query || undefined,
            status: status === 'Tous' ? undefined : status,
            priority: priority === 'Toutes' ? undefined : priority,
            assigneeId: isAdmin && technicianFilter !== 'Tous' ? technicianFilter : undefined,
        }),
        [query, status, priority, technicianFilter, isAdmin],
    )

    const ticketsQuery = useTickets(listQuery)
    const techniciansQuery = useTechnicians({ page: 1, limit: 50 }, { enabled: isAdmin })
    const categoriesQuery = useCategories({ isActive: true }, { enabled: canCreate })
    const createTicket = useCreateTicket()

    const tickets = useMemo(
        () => ticketsQuery.data?.data ?? [],
        [ticketsQuery.data?.data],
    )
    const technicians = techniciansQuery.data?.data ?? []
    const categories = categoriesQuery.data ?? []

    const openFromQuery = searchParams.get('new') === '1'
    const [createRequested, setCreateRequested] = useState(false)
    const createOpen = canCreate && (createRequested || openFromQuery)

    const closeCreate = () => {
        setCreateRequested(false)
        if (openFromQuery) {
            router.replace('/dashboard/tickets', { scroll: false })
        }
    }
    const [createForm, setCreateForm] = useState({
        title: '',
        description: '',
        priority: 'NORMAL' as TicketPriority,
        categoryId: '',
        siteLabel: '',
    })

    const [assigning, setAssigning] = useState<TicketListItem | null>(null)

    const openCount = tickets.filter((t) => t.status === 'OPEN').length
    const inProgress = tickets.filter((t) => t.status === 'IN_PROGRESS').length
    const resolved = tickets.filter((t) => t.status === 'RESOLVED').length
    const urgent = tickets.filter(
        (t) =>
            t.priority === 'CRITICAL' &&
            t.status !== 'RESOLVED' &&
            t.status !== 'CLOSED' &&
            t.status !== 'CANCELLED',
    ).length

    const [showCreateErrors, setShowCreateErrors] = useState(false)

    const openCreate = () => {
        setCreateForm({
            title: '',
            description: '',
            priority: 'NORMAL',
            categoryId: categories[0]?.id ?? '',
            siteLabel: '',
        })
        setShowCreateErrors(false)
        setCreateRequested(true)
    }

    const isValidTitle =
        createForm.title.trim().length >= TICKET_TITLE_MIN_LENGTH &&
        createForm.title.trim().length <= TICKET_TITLE_MAX_LENGTH
    const isValidSite =
        createForm.siteLabel.trim().length >= SITE_LABEL_MIN_LENGTH &&
        createForm.siteLabel.trim().length <= SITE_LABEL_MAX_LENGTH
    const isValidDescription =
        createForm.description.trim().length > 0 &&
        createForm.description.trim().length <= DESCRIPTION_MAX_LENGTH

    const canSubmitCreate =
        isValidTitle && isValidDescription && !!createForm.categoryId && isValidSite

    const submitCreate = () => {
        if (!canSubmitCreate) {
            setShowCreateErrors(true)
            return
        }

        createTicket.mutate(
            {
                title: createForm.title.trim(),
                description: createForm.description.trim(),
                priority: createForm.priority,
                categoryId: createForm.categoryId,
                siteLabel: createForm.siteLabel.trim(),
            },
            { onSuccess: () => closeCreate() },
        )
    }

    const openAssign = (ticket: TicketListItem) => {
        setAssigning(ticket)
    }

    const technicianName = (tech: Technician) =>
        displayPersonName(tech.firstName, tech.lastName, tech.username)

    const heading = isTechnician
        ? 'Tickets qui me sont affectés'
        : isAdmin
          ? 'Tickets'
          : 'Mes tickets'
    const subheading = isTechnician
        ? 'Uniquement les tickets qui vous ont été assignés'
        : isAdmin
          ? `${ticketsQuery.data?.meta.total ?? tickets.length} tickets au total · ${openCount} ouvert${openCount > 1 ? 's' : ''}`
          : 'Historique des tickets que vous avez créés'

    return (
        <div className="space-y-5">
            <div className="flex items-start justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-moon-abyss">{heading}</h1>
                    <p className="mt-0.5 text-sm text-moon-abyss/70">{subheading}</p>
                </div>
                {canCreate && (
                    <button
                        type="button"
                        onClick={openCreate}
                        className="flex items-center gap-2 rounded-lg bg-moon-violet-dark px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-moon-violet"
                    >
                        <Plus size={16} />
                        Créer un ticket
                    </button>
                )}
            </div>

            {ticketsQuery.isError && (
                <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
                    Impossible de charger les tickets. Vérifiez que vous êtes connecté et que l’API
                    tourne.
                </p>
            )}

            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <StatCard value={openCount} label="Tickets ouverts" tone="rose" />
                <StatCard value={inProgress} label="En cours" tone="violet" />
                <StatCard value={resolved} label="Résolus" tone="green" />
                <StatCard value={urgent} label="Urgents" tone="plum" />
            </div>

            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-moon-abyss/15 bg-white p-3 shadow-sm">
                <div className="flex min-w-56 flex-1 items-center gap-2 rounded-lg border border-moon-rose/40 bg-moon-rose/25 px-3 py-2">
                    <Search size={15} className="text-moon-violet" />
                    <input
                        type="search"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Rechercher..."
                        className="w-full bg-transparent text-sm text-moon-abyss placeholder:text-moon-abyss/55 focus:outline-none"
                    />
                </div>
                <div className="flex items-center gap-2 rounded-lg border border-moon-abyss/15 px-3 py-2 text-sm text-moon-abyss">
                    <Filter size={14} />
                    <select
                        value={status}
                        onChange={(e) => setStatus(e.target.value as typeof status)}
                        className="bg-transparent focus:outline-none"
                        aria-label="Filtrer par statut"
                    >
                        <option value="Tous">Statut</option>
                        <option value="OPEN">Ouvert</option>
                        <option value="ASSIGNED">Affecté</option>
                        <option value="IN_PROGRESS">En cours</option>
                        <option value="RESOLVED">Résolu</option>
                        <option value="CLOSED">Fermé</option>
                        <option value="CANCELLED">Annulé</option>
                    </select>
                </div>
                <div className="flex items-center gap-2 rounded-lg border border-moon-abyss/15 px-3 py-2 text-sm text-moon-abyss">
                    <select
                        value={priority}
                        onChange={(e) => setPriority(e.target.value as typeof priority)}
                        className="bg-transparent focus:outline-none"
                        aria-label="Filtrer par priorité"
                    >
                        <option value="Toutes">Priorité</option>
                        <option value="CRITICAL">Urgente</option>
                        <option value="HIGH">Haute</option>
                        <option value="NORMAL">Moyenne</option>
                        <option value="LOW">Basse</option>
                    </select>
                </div>
                {isAdmin && (
                    <div className="flex items-center gap-2 rounded-lg border border-moon-abyss/15 px-3 py-2 text-sm text-moon-abyss">
                        <select
                            value={technicianFilter}
                            onChange={(e) => setTechnicianFilter(e.target.value)}
                            className="bg-transparent focus:outline-none"
                            aria-label="Filtrer par technicien"
                        >
                            <option value="Tous">Technicien</option>
                            {technicians.map((t) => (
                                <option key={t.id} value={t.id}>
                                    {technicianName(t)}
                                </option>
                            ))}
                        </select>
                    </div>
                )}
                <div className="ml-auto flex gap-1">
                    <button
                        type="button"
                        aria-label="Vue liste"
                        aria-pressed={viewMode === 'list'}
                        onClick={() => setViewMode('list')}
                        className={`rounded-lg p-2 transition-colors ${
                            viewMode === 'list'
                                ? 'bg-moon-violet-dark text-white'
                                : 'border border-moon-abyss/10 text-moon-abyss/70 hover:bg-moon-rose/30'
                        }`}
                    >
                        <List size={15} />
                    </button>
                    <button
                        type="button"
                        aria-label="Vue grille"
                        aria-pressed={viewMode === 'grid'}
                        onClick={() => setViewMode('grid')}
                        className={`rounded-lg p-2 transition-colors ${
                            viewMode === 'grid'
                                ? 'bg-moon-violet-dark text-white'
                                : 'border border-moon-abyss/10 text-moon-abyss/70 hover:bg-moon-rose/30'
                        }`}
                    >
                        <LayoutGrid size={15} />
                    </button>
                </div>
            </div>

            <p className="font-mono text-xs uppercase tracking-widest text-moon-abyss/65">
                {ticketsQuery.isLoading ? 'Chargement…' : `${tickets.length} tickets trouvés`}
            </p>

            {viewMode === 'grid' && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {tickets.map((t) => {
                        const assignee = t.assignee?.username ?? null
                        return (
                            <div
                                key={t.id}
                                className="flex flex-col gap-3 rounded-2xl border border-moon-abyss/15 bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
                            >
                                <div className="flex items-start justify-between gap-2">
                                    <Link href={`/dashboard/tickets/${t.id}`} className="min-w-0">
                                        <p className="font-mono text-xs text-moon-abyss/65">{t.reference}</p>
                                        <p className="truncate font-semibold text-moon-abyss hover:text-moon-violet">
                                            {t.title}
                                        </p>
                                    </Link>
                                    <span
                                        className={`shrink-0 rounded-md px-2 py-1 text-[11px] font-bold tracking-wide ${statusStyles[t.status]}`}
                                    >
                                        {statusLabels[t.status]}
                                    </span>
                                </div>
                                <p className="truncate text-sm text-moon-abyss/70">{t.category.name}</p>
                                <div className="flex items-center justify-between text-sm">
                                    <span className="flex items-center gap-1.5 text-moon-abyss/70">
                                        <span className={`h-2 w-2 rounded-full ${priorityDots[t.priority]}`} />
                                        {priorityLabels[t.priority]}
                                    </span>
                                    <span className="font-mono text-xs text-moon-abyss/70">
                                        {formatDate(t.createdAt)}
                                    </span>
                                </div>
                                <div className="mt-auto flex items-center justify-between border-t border-moon-abyss/5 pt-3">
                                    {assignee ? (
                                        <span className="flex min-w-0 items-center gap-2 text-sm text-moon-abyss/80">
                                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-moon-lavande/15 text-[10px] font-bold text-moon-lavande">
                                                {initialsOf(assignee)}
                                            </span>
                                            <span className="truncate">{assignee}</span>
                                        </span>
                                    ) : (
                                        <span className="text-sm text-moon-abyss/65">Non affecté</span>
                                    )}
                                    {isAdmin && canAssignStatus(t.status) ? (
                                        <button
                                            type="button"
                                            onClick={() => openAssign(t)}
                                            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-moon-violet/25 px-3 py-1.5 text-xs font-medium text-moon-violet transition-colors hover:bg-moon-violet hover:text-white"
                                        >
                                            <ArrowRight size={13} />
                                            {assignee ? 'Réaffecter' : 'Affecter'}
                                        </button>
                                    ) : (
                                        <Link
                                            href={`/dashboard/tickets/${t.id}`}
                                            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-moon-violet/25 px-3 py-1.5 text-xs font-medium text-moon-violet transition-colors hover:bg-moon-violet hover:text-white"
                                        >
                                            Détails
                                        </Link>
                                    )}
                                </div>
                            </div>
                        )
                    })}
                </div>
            )}

            {viewMode === 'list' && (
                <div className="overflow-hidden rounded-2xl border border-moon-abyss/15 bg-white shadow-sm">
                    <table className="w-full text-left text-sm">
                        <thead>
                            <tr className="border-b border-moon-abyss/8 font-mono text-[11px] uppercase tracking-widest text-moon-abyss/65">
                                <th className="px-5 py-3 font-medium">Réf. / Titre</th>
                                <th className="px-5 py-3 font-medium">Catégorie</th>
                                <th className="px-5 py-3 font-medium">Statut</th>
                                <th className="px-5 py-3 font-medium">Priorité</th>
                                <th className="px-5 py-3 font-medium">Technicien</th>
                                <th className="px-5 py-3 font-medium">Créé le</th>
                                <th className="px-5 py-3 font-medium" />
                            </tr>
                        </thead>
                        <tbody>
                            {tickets.map((t) => {
                                const assignee = t.assignee?.username ?? null
                                return (
                                    <tr
                                        key={t.id}
                                        className="border-b border-moon-abyss/5 last:border-0 hover:bg-moon-rose/10"
                                    >
                                        <td className="px-5 py-3.5">
                                            <Link href={`/dashboard/tickets/${t.id}`} className="block">
                                                <p className="font-mono text-xs text-moon-abyss/65">{t.reference}</p>
                                                <p className="font-semibold text-moon-abyss hover:text-moon-violet">
                                                    {t.title}
                                                </p>
                                            </Link>
                                        </td>
                                        <td className="max-w-36 truncate px-5 py-3.5 text-moon-abyss/70">
                                            {t.category.name}
                                        </td>
                                        <td className="px-5 py-3.5">
                                            <span
                                                className={`rounded-md px-2 py-1 text-[11px] font-bold tracking-wide ${statusStyles[t.status]}`}
                                            >
                                                {statusLabels[t.status]}
                                            </span>
                                        </td>
                                        <td className="px-5 py-3.5">
                                            <span className="flex items-center gap-1.5 text-moon-abyss/70">
                                                <span
                                                    className={`h-2 w-2 rounded-full ${priorityDots[t.priority]}`}
                                                />
                                                {priorityLabels[t.priority]}
                                            </span>
                                        </td>
                                        <td className="px-5 py-3.5">
                                            {assignee ? (
                                                <span className="flex items-center gap-2 text-moon-abyss/80">
                                                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-moon-lavande/15 text-[10px] font-bold text-moon-lavande">
                                                        {initialsOf(assignee)}
                                                    </span>
                                                    {assignee}
                                                </span>
                                            ) : (
                                                <span className="text-moon-abyss/65">Non affecté</span>
                                            )}
                                        </td>
                                        <td className="whitespace-nowrap px-5 py-3.5 font-mono text-xs text-moon-abyss/70">
                                            {formatDate(t.createdAt)}
                                        </td>
                                        <td className="px-5 py-3.5 text-right">
                                            {isAdmin && canAssignStatus(t.status) ? (
                                                <button
                                                    type="button"
                                                    onClick={() => openAssign(t)}
                                                    className="inline-flex items-center gap-1.5 rounded-lg border border-moon-violet/25 px-3 py-1.5 text-xs font-medium text-moon-violet transition-colors hover:bg-moon-violet hover:text-white"
                                                >
                                                    <ArrowRight size={13} />
                                                    {assignee ? 'Réaffecter' : 'Affecter'}
                                                </button>
                                            ) : (
                                                <Link
                                                    href={`/dashboard/tickets/${t.id}`}
                                                    className="inline-flex items-center gap-1.5 rounded-lg border border-moon-violet/25 px-3 py-1.5 text-xs font-medium text-moon-violet transition-colors hover:bg-moon-violet hover:text-white"
                                                >
                                                    Détails
                                                </Link>
                                            )}
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            <Modal open={createOpen} title="Créer un ticket" onClose={closeCreate}>
                <div className="space-y-4">
                    <div>
                        <label htmlFor="ticket-title" className={ticketLabelClass}>
                            Titre<RequiredMark />
                        </label>
                        <input
                            id="ticket-title"
                            type="text"
                            value={createForm.title}
                            onChange={(e) => setCreateForm((f) => ({ ...f, title: e.target.value }))}
                            placeholder="Ex : Panne réseau au 2e étage"
                            maxLength={TICKET_TITLE_MAX_LENGTH}
                            className={ticketFieldClass}
                        />
                        {showCreateErrors && !isValidTitle && (
                            <p className="mt-1 text-xs text-rose-700">
                                {requiredFieldMessage(
                                    createForm.title,
                                    'Le titre est requis.',
                                    `Le titre doit contenir entre ${TICKET_TITLE_MIN_LENGTH} et ${TICKET_TITLE_MAX_LENGTH} caractères.`,
                                )}
                            </p>
                        )}
                    </div>
                    <div>
                        <label htmlFor="ticket-site" className={ticketLabelClass}>
                            Site / lieu d&apos;intervention<RequiredMark />
                        </label>
                        <input
                            id="ticket-site"
                            type="text"
                            value={createForm.siteLabel}
                            onChange={(e) =>
                                setCreateForm((f) => ({ ...f, siteLabel: e.target.value }))
                            }
                            placeholder="Ex : Agence Lomé Centre, 2e étage"
                            maxLength={SITE_LABEL_MAX_LENGTH}
                            className={ticketFieldClass}
                        />
                        {showCreateErrors && !isValidSite && (
                            <p className="mt-1 text-xs text-rose-700">
                                {requiredFieldMessage(
                                    createForm.siteLabel,
                                    'Le site est requis.',
                                    `Le site doit contenir entre ${SITE_LABEL_MIN_LENGTH} et ${SITE_LABEL_MAX_LENGTH} caractères.`,
                                )}
                            </p>
                        )}
                    </div>
                    <div>
                        <label htmlFor="ticket-category" className={ticketLabelClass}>
                            Catégorie<RequiredMark />
                        </label>
                        <select
                            id="ticket-category"
                            value={createForm.categoryId}
                            onChange={(e) =>
                                setCreateForm((f) => ({ ...f, categoryId: e.target.value }))
                            }
                            className={ticketFieldClass}
                        >
                            <option value="">Choisir une catégorie</option>
                            {categories.map((c) => (
                                <option key={c.id} value={c.id}>
                                    {c.name}
                                </option>
                            ))}
                        </select>
                        {categoriesQuery.isError && (
                            <p className="mt-1 text-xs text-rose-700">
                                Impossible de charger les catégories.
                            </p>
                        )}
                        {!categoriesQuery.isError && categories.length === 0 && (
                            <p className="mt-1 text-xs text-moon-abyss/70">
                                Aucune catégorie active. Un administrateur doit en créer une.
                            </p>
                        )}
                        {showCreateErrors && !categoriesQuery.isError && categories.length > 0 && !createForm.categoryId && (
                            <p className="mt-1 text-xs text-rose-700">Choisissez une catégorie.</p>
                        )}
                    </div>
                    <div>
                        <label htmlFor="ticket-priority" className={ticketLabelClass}>
                            Priorité
                        </label>
                        <select
                            id="ticket-priority"
                            value={createForm.priority}
                            onChange={(e) =>
                                setCreateForm((f) => ({
                                    ...f,
                                    priority: e.target.value as TicketPriority,
                                }))
                            }
                            className={ticketFieldClass}
                        >
                            <option value="LOW">Basse</option>
                            <option value="NORMAL">Moyenne</option>
                            <option value="HIGH">Haute</option>
                            <option value="CRITICAL">Urgente</option>
                        </select>
                    </div>
                    <div>
                        <label htmlFor="ticket-description" className={ticketLabelClass}>
                            Description<RequiredMark />
                        </label>
                        <textarea
                            id="ticket-description"
                            value={createForm.description}
                            onChange={(e) =>
                                setCreateForm((f) => ({ ...f, description: e.target.value }))
                            }
                            placeholder="Décrivez le problème..."
                            rows={3}
                            maxLength={DESCRIPTION_MAX_LENGTH}
                            className={`${ticketFieldClass} resize-none`}
                        />
                        {showCreateErrors && !isValidDescription && (
                            <p className="mt-1 text-xs text-rose-700">La description est requise.</p>
                        )}
                    </div>
                    {createTicket.isError && (
                        <p className="text-sm text-rose-700">
                            {createTicket.error instanceof Error
                                ? createTicket.error.message
                                : 'Création impossible'}
                        </p>
                    )}
                    <div className="flex justify-end gap-2.5 pt-2">
                        <button
                            type="button"
                            onClick={closeCreate}
                            className="rounded-lg border border-moon-abyss/15 px-4 py-2.5 text-sm font-medium text-moon-abyss/70 hover:bg-moon-rose/20"
                        >
                            Annuler
                        </button>
                        <button
                            type="button"
                            onClick={submitCreate}
                            disabled={createTicket.isPending}
                            className="rounded-lg bg-moon-violet-dark px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-moon-violet disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            {createTicket.isPending ? 'Création…' : 'Créer le ticket'}
                        </button>
                    </div>
                </div>
            </Modal>

            <AssignTicketModal ticket={assigning} onClose={() => setAssigning(null)} />
        </div>
    )
}

export default function TicketsPage() {
    return (
        <Suspense fallback={<p>Chargement des données...</p>}>
            <TicketsContent />
        </Suspense>
    )
}
