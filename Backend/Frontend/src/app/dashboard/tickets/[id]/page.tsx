'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { ArrowLeft } from 'lucide-react'
import Modal from '@/features/dashboard/components/Modal'
import AssignTicketModal from '@/features/tickets/AssignTicketModal'
import TicketComments from '@/features/tickets/TicketComments'
import TicketAttachments from '@/features/tickets/TicketAttachments'
import RequiredMark from '@/components/RequiredMark'
import {
    TICKET_TITLE_MIN_LENGTH,
    TICKET_TITLE_MAX_LENGTH,
    SITE_LABEL_MAX_LENGTH,
    DESCRIPTION_MAX_LENGTH,
    RESOLUTION_NOTE_MAX_LENGTH,
    REASON_MAX_LENGTH,
} from '@/lib/validators'
import {
    useTicket,
    useUpdateTicket,
    useStartTicket,
    useResolveTicket,
    useReopenTicket,
    useCloseTicket,
    useCancelTicket,
} from '@/hooks/useTickets'
import { useCategories } from '@/hooks/useCategories'
import type { TicketPriority } from '@/types/ticket'
import {
    canAssignStatus,
    displayPersonName,
    formatDate,
    priorityDots,
    priorityLabels,
    statusLabels,
    statusStyles,
    ticketFieldClass,
    ticketLabelClass,
} from '@/features/tickets/ticketUi'

export default function TicketDetailPage() {
    const params = useParams<{ id: string }>()
    const id = params.id
    const { data: session } = useSession()
    const role = session?.user?.role
    const userId = session?.user?.id
    const isAdmin = role === 'ADMIN'
    const isTechnician = role === 'TECHNICIAN'
    const isClient = role === 'CLIENT'

    const ticketQuery = useTicket(id)
    const categoriesQuery = useCategories({ isActive: true })
    const updateTicket = useUpdateTicket()
    const startTicket = useStartTicket()
    const resolveTicket = useResolveTicket()
    const reopenTicket = useReopenTicket()
    const closeTicket = useCloseTicket()
    const cancelTicket = useCancelTicket()

    const ticket = ticketQuery.data
    const categories = categoriesQuery.data ?? []

    const isOwner = Boolean(ticket && userId && ticket.createdBy.id === userId)
    const isAssignee = Boolean(ticket && userId && ticket.assignee?.id === userId)
    const canPatch =
        Boolean(ticket) && (isAdmin || (isClient && isOwner && ticket?.status === 'OPEN'))
    const canAssign = Boolean(isAdmin && ticket && canAssignStatus(ticket.status))
    const canStart =
        ticket?.status === 'ASSIGNED' && (isAdmin || (isTechnician && isAssignee))
    const canResolve = ticket?.status === 'IN_PROGRESS' && isTechnician && isAssignee
    const canCancel =
        Boolean(ticket) &&
        ((isAdmin &&
            (ticket?.status === 'OPEN' ||
                ticket?.status === 'ASSIGNED' ||
                ticket?.status === 'IN_PROGRESS')) ||
            (isClient && isOwner && ticket?.status === 'OPEN'))
    const canReopen =
        ticket?.status === 'RESOLVED' && (isAdmin || (isClient && isOwner))
    const canClose = ticket?.status === 'RESOLVED' && (isAdmin || (isClient && isOwner))

    const [editOpen, setEditOpen] = useState(false)
    const [editForm, setEditForm] = useState({
        title: '',
        description: '',
        priority: 'NORMAL' as TicketPriority,
        categoryId: '',
        siteLabel: '',
    })
    const [assignOpen, setAssignOpen] = useState(false)
    const [reasonOpen, setReasonOpen] = useState<'cancel' | 'reopen' | null>(null)
    const [reason, setReason] = useState('')
    const [resolveOpen, setResolveOpen] = useState(false)
    const [resolutionNote, setResolutionNote] = useState('')

    const openEdit = () => {
        if (!ticket) return
        setEditForm({
            title: ticket.title,
            description: ticket.description,
            priority: ticket.priority,
            categoryId: ticket.category.id,
            siteLabel: ticket.siteLabel ?? '',
        })
        setEditOpen(true)
    }

    const canSubmitEdit =
        editForm.title.trim().length >= TICKET_TITLE_MIN_LENGTH &&
        editForm.title.trim().length <= TICKET_TITLE_MAX_LENGTH &&
        editForm.description.trim().length > 0 &&
        editForm.description.trim().length <= DESCRIPTION_MAX_LENGTH

    const submitEdit = () => {
        if (!ticket || !canSubmitEdit) return
        updateTicket.mutate(
            {
                id: ticket.id,
                body: {
                    title: editForm.title.trim(),
                    description: editForm.description.trim(),
                    priority: editForm.priority,
                    categoryId: editForm.categoryId || undefined,
                    siteLabel: editForm.siteLabel.trim() || undefined,
                },
            },
            { onSuccess: () => setEditOpen(false) },
        )
    }

    const confirmReason = () => {
        if (!ticket || !reasonOpen) return
        if (reasonOpen === 'cancel') {
            cancelTicket.mutate(
                { id: ticket.id, body: { reason: reason.trim() || undefined } },
                { onSuccess: () => setReasonOpen(null) },
            )
        } else {
            if (!reason.trim()) return
            reopenTicket.mutate(
                { id: ticket.id, body: { reason: reason.trim() } },
                { onSuccess: () => setReasonOpen(null) },
            )
        }
    }

    const confirmResolve = () => {
        if (!ticket || !resolutionNote.trim()) return
        resolveTicket.mutate(
            { id: ticket.id, body: { resolutionNote: resolutionNote.trim() } },
            { onSuccess: () => setResolveOpen(false) },
        )
    }

    const mutationError =
        updateTicket.error ??
        startTicket.error ??
        resolveTicket.error ??
        reopenTicket.error ??
        closeTicket.error ??
        cancelTicket.error

    if (ticketQuery.isLoading) {
        return <p className="text-sm text-moon-abyss/70">Chargement du ticket…</p>
    }

    if (ticketQuery.isError || !ticket) {
        // 403 means the ticket exists but the caller lost access to it (e.g. a technician
        // reassigned elsewhere) — distinct from a genuinely unknown id (404) or other failure.
        const status =
            ticketQuery.error instanceof Error
                ? (ticketQuery.error as Error & { status?: number }).status
                : undefined
        const message =
            status === 403 ? 'Ticket indisponible.' : 'Ticket introuvable ou accès refusé.'

        return (
            <div className="space-y-3">
                <Link
                    href="/dashboard/tickets"
                    className="inline-flex items-center gap-1.5 text-sm text-moon-violet hover:text-moon-violet-dark"
                >
                    <ArrowLeft size={14} />
                    Retour aux tickets
                </Link>
                <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{message}</p>
            </div>
        )
    }

    const assigneeName = ticket.assignee
        ? displayPersonName(ticket.assignee.firstName, ticket.assignee.lastName, ticket.assignee.username)
        : null
    const creatorName = displayPersonName(
        ticket.createdBy.firstName,
        ticket.createdBy.lastName,
        ticket.createdBy.username,
    )

    return (
        <div className="space-y-5">
            <Link
                href="/dashboard/tickets"
                className="inline-flex items-center gap-1.5 text-sm text-moon-violet hover:text-moon-violet-dark"
            >
                <ArrowLeft size={14} />
                Retour aux tickets
            </Link>

            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <p className="font-mono text-xs text-moon-abyss/65">{ticket.reference}</p>
                    <h1 className="text-2xl font-bold text-moon-abyss">{ticket.title}</h1>
                </div>
                <span
                    className={`rounded-md px-2.5 py-1 text-xs font-bold tracking-wide ${statusStyles[ticket.status]}`}
                >
                    {statusLabels[ticket.status]}
                </span>
            </div>

            {mutationError instanceof Error && (
                <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
                    {mutationError.message}
                </p>
            )}

            <div className="flex flex-wrap gap-2">
                {canPatch && (
                    <button
                        type="button"
                        onClick={openEdit}
                        className="rounded-lg border border-moon-abyss/15 px-3 py-2 text-sm font-medium text-moon-abyss/80 hover:bg-moon-rose/20"
                    >
                        Modifier
                    </button>
                )}
                {canAssign && (
                    <button
                        type="button"
                        onClick={() => setAssignOpen(true)}
                        className="rounded-lg border border-moon-violet/25 px-3 py-2 text-sm font-medium text-moon-violet hover:bg-moon-violet hover:text-white"
                    >
                        {ticket.assignee ? 'Réaffecter' : 'Affecter'}
                    </button>
                )}
                {canStart && (
                    <button
                        type="button"
                        onClick={() => startTicket.mutate(ticket.id)}
                        disabled={startTicket.isPending}
                        className="rounded-lg bg-moon-violet-dark px-3 py-2 text-sm font-medium text-white hover:bg-moon-violet disabled:opacity-40"
                    >
                        {startTicket.isPending ? 'Envoi…' : 'Prendre en charge'}
                    </button>
                )}
                {canResolve && (
                    <button
                        type="button"
                        onClick={() => {
                            setResolutionNote('')
                            setResolveOpen(true)
                        }}
                        className="rounded-lg bg-moon-violet-dark px-3 py-2 text-sm font-medium text-white hover:bg-moon-violet"
                    >
                        Marquer résolu
                    </button>
                )}
                {canReopen && (
                    <button
                        type="button"
                        onClick={() => {
                            setReason('')
                            setReasonOpen('reopen')
                        }}
                        className="rounded-lg border border-amber-300 px-3 py-2 text-sm font-medium text-amber-800 hover:bg-amber-50"
                    >
                        Réouvrir
                    </button>
                )}
                {canClose && (
                    <button
                        type="button"
                        onClick={() => closeTicket.mutate(ticket.id)}
                        disabled={closeTicket.isPending}
                        className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-40"
                    >
                        {closeTicket.isPending ? 'Envoi…' : 'Clôturer'}
                    </button>
                )}
                {canCancel && (
                    <button
                        type="button"
                        onClick={() => {
                            setReason('')
                            setReasonOpen('cancel')
                        }}
                        className="rounded-lg border border-rose-200 px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50"
                    >
                        Annuler
                    </button>
                )}
            </div>

            <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
                <div className="rounded-2xl border border-moon-abyss/15 bg-white p-5 shadow-sm">
                    <h2 className="font-bold text-moon-violet-dark">Description</h2>
                    <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-moon-abyss/80">
                        {ticket.description}
                    </p>
                    {ticket.resolutionNote && (
                        <div className="mt-5 rounded-lg bg-emerald-50 px-3.5 py-3">
                            <p className={ticketLabelClass}>Note de résolution</p>
                            <p className="text-sm text-emerald-900">{ticket.resolutionNote}</p>
                        </div>
                    )}
                </div>
                <div className="space-y-3 rounded-2xl border border-moon-abyss/15 bg-white p-5 shadow-sm">
                    <p className={ticketLabelClass}>Catégorie</p>
                    <p className="text-sm font-medium text-moon-abyss">{ticket.category.name}</p>
                    <p className={ticketLabelClass}>Priorité</p>
                    <p className="flex items-center gap-1.5 text-sm text-moon-abyss">
                        <span className={`h-2 w-2 rounded-full ${priorityDots[ticket.priority]}`} />
                        {priorityLabels[ticket.priority]}
                    </p>
                    <p className={ticketLabelClass}>Créé par</p>
                    <p className="text-sm text-moon-abyss">{creatorName}</p>
                    <p className={ticketLabelClass}>Technicien</p>
                    <p className="text-sm text-moon-abyss">{assigneeName ?? 'Non affecté'}</p>
                    <p className={ticketLabelClass}>Site</p>
                    <p className="text-sm text-moon-abyss">{ticket.siteLabel ?? '—'}</p>
                    <p className={ticketLabelClass}>Créé le</p>
                    <p className="font-mono text-xs text-moon-abyss/60">{formatDate(ticket.createdAt)}</p>
                    {ticket.slaDueAt && (
                        <>
                            <p className={ticketLabelClass}>Échéance SLA</p>
                            <p className="font-mono text-xs text-moon-abyss/60">
                                {formatDate(ticket.slaDueAt)}
                            </p>
                        </>
                    )}
                </div>
            </div>

            <TicketComments ticketId={ticket.id} role={role} />
            <TicketAttachments ticketId={ticket.id} role={role} />

            <Modal open={editOpen} title="Modifier le ticket" onClose={() => setEditOpen(false)}>
                <div className="space-y-4">
                    <div>
                        <label htmlFor="edit-title" className={ticketLabelClass}>
                            Titre<RequiredMark />
                        </label>
                        <input
                            id="edit-title"
                            value={editForm.title}
                            onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
                            maxLength={TICKET_TITLE_MAX_LENGTH}
                            className={ticketFieldClass}
                        />
                    </div>
                    <div>
                        <label htmlFor="edit-category" className={ticketLabelClass}>
                            Catégorie<RequiredMark />
                        </label>
                        <select
                            id="edit-category"
                            value={editForm.categoryId}
                            onChange={(e) => setEditForm((f) => ({ ...f, categoryId: e.target.value }))}
                            className={ticketFieldClass}
                        >
                            {categories.map((c) => (
                                <option key={c.id} value={c.id}>
                                    {c.name}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label htmlFor="edit-priority" className={ticketLabelClass}>
                            Priorité
                        </label>
                        <select
                            id="edit-priority"
                            value={editForm.priority}
                            onChange={(e) =>
                                setEditForm((f) => ({
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
                        <label htmlFor="edit-site" className={ticketLabelClass}>
                            Site
                        </label>
                        <input
                            id="edit-site"
                            value={editForm.siteLabel}
                            onChange={(e) => setEditForm((f) => ({ ...f, siteLabel: e.target.value }))}
                            maxLength={SITE_LABEL_MAX_LENGTH}
                            className={ticketFieldClass}
                        />
                    </div>
                    <div>
                        <label htmlFor="edit-description" className={ticketLabelClass}>
                            Description<RequiredMark />
                        </label>
                        <textarea
                            id="edit-description"
                            value={editForm.description}
                            onChange={(e) =>
                                setEditForm((f) => ({ ...f, description: e.target.value }))
                            }
                            rows={4}
                            maxLength={DESCRIPTION_MAX_LENGTH}
                            className={`${ticketFieldClass} resize-none`}
                        />
                    </div>
                    <div className="flex justify-end gap-2.5">
                        <button
                            type="button"
                            onClick={() => setEditOpen(false)}
                            className="rounded-lg border border-moon-abyss/15 px-4 py-2.5 text-sm font-medium text-moon-abyss/70 hover:bg-moon-rose/20"
                        >
                            Annuler
                        </button>
                        <button
                            type="button"
                            onClick={submitEdit}
                            disabled={!canSubmitEdit || updateTicket.isPending}
                            className="rounded-lg bg-moon-violet-dark px-4 py-2.5 text-sm font-medium text-white hover:bg-moon-violet disabled:opacity-40"
                        >
                            {updateTicket.isPending ? 'Enregistrement…' : 'Enregistrer'}
                        </button>
                    </div>
                </div>
            </Modal>

            <AssignTicketModal
                ticket={assignOpen ? ticket : null}
                onClose={() => setAssignOpen(false)}
            />

            <Modal
                open={!!reasonOpen}
                title={reasonOpen === 'reopen' ? 'Réouvrir le ticket' : 'Annuler le ticket'}
                onClose={() => setReasonOpen(null)}
            >
                <label htmlFor="ticket-reason" className={ticketLabelClass}>
                    Motif
                    {reasonOpen === 'reopen' && <RequiredMark />}
                </label>
                <textarea
                    id="ticket-reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={3}
                    maxLength={REASON_MAX_LENGTH}
                    className={`${ticketFieldClass} resize-none`}
                />
                <div className="mt-5 flex justify-end gap-2.5">
                    <button
                        type="button"
                        onClick={() => setReasonOpen(null)}
                        className="rounded-lg border border-moon-abyss/15 px-4 py-2.5 text-sm font-medium text-moon-abyss/70"
                    >
                        Retour
                    </button>
                    <button
                        type="button"
                        onClick={confirmReason}
                        disabled={
                            (reasonOpen === 'reopen' && !reason.trim()) ||
                            cancelTicket.isPending ||
                            reopenTicket.isPending
                        }
                        className="rounded-lg bg-moon-violet-dark px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40"
                    >
                        Confirmer
                    </button>
                </div>
            </Modal>

            <Modal open={resolveOpen} title="Résoudre le ticket" onClose={() => setResolveOpen(false)}>
                <label htmlFor="resolution-note" className={ticketLabelClass}>
                    Note de résolution<RequiredMark />
                </label>
                <textarea
                    id="resolution-note"
                    value={resolutionNote}
                    onChange={(e) => setResolutionNote(e.target.value)}
                    rows={4}
                    maxLength={RESOLUTION_NOTE_MAX_LENGTH}
                    className={`${ticketFieldClass} resize-none`}
                    placeholder="Décrivez la solution apportée…"
                />
                <div className="mt-5 flex justify-end gap-2.5">
                    <button
                        type="button"
                        onClick={() => setResolveOpen(false)}
                        className="rounded-lg border border-moon-abyss/15 px-4 py-2.5 text-sm font-medium text-moon-abyss/70"
                    >
                        Annuler
                    </button>
                    <button
                        type="button"
                        onClick={confirmResolve}
                        disabled={!resolutionNote.trim() || resolveTicket.isPending}
                        className="rounded-lg bg-moon-violet-dark px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40"
                    >
                        {resolveTicket.isPending ? 'Envoi…' : 'Résoudre'}
                    </button>
                </div>
            </Modal>
        </div>
    )
}
