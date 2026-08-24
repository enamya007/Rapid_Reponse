'use client'

import { useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import Modal from '@/features/dashboard/components/Modal'
import RequiredMark from '@/components/RequiredMark'
import { useAssignTicket, useAssignmentSuggestions } from '@/hooks/useTickets'
import { useTechnicians } from '@/hooks/useTechnicians'
import type { TicketStatus } from '@/types/ticket'
import type { Technician } from '@/types/technician'
import { REASON_MAX_LENGTH } from '@/lib/validators'
import {
  displayPersonName,
  initialsOf,
  ticketFieldClass,
  ticketLabelClass,
} from '@/features/tickets/ticketUi'

type AssignableTicket = {
  id: string
  reference: string
  title: string
  status: TicketStatus
  assignee: { id: string } | null
}

export default function AssignTicketModal({
  ticket,
  onClose,
}: {
  ticket: AssignableTicket | null
  onClose: () => void
}) {
  return (
    <Modal
      open={!!ticket}
      title={ticket?.assignee ? 'Réaffecter le ticket' : 'Affecter le ticket'}
      onClose={onClose}
      size="lg"
    >
      {ticket && <AssignTicketModalBody key={ticket.id} ticket={ticket} onClose={onClose} />}
    </Modal>
  )
}

// A technician is only truly BLOCKED by the backend (403) when inactive, unavailable, or at
// capacity (`TechnicianSuggestionService.evaluateEligibility`) — the required skill is merely a
// suggestion-ranking filter, never enforced on the actual assign call. So a technician missing
// the skill can still be picked here; only these two reasons mean the backend will refuse them.
function eligibilityReason(t: Technician): string | null {
  if (!t.isAvailable) return 'Indisponible'
  if (t.currentLoad >= t.maxConcurrentTickets) return 'Charge max atteinte'
  return null
}

function AssignTicketModalBody({
  ticket,
  onClose,
}: {
  ticket: AssignableTicket
  onClose: () => void
}) {
  const suggestionsQuery = useAssignmentSuggestions(ticket.id)
  const allTechniciansQuery = useTechnicians({ page: 1, limit: 100, isActive: true })
  const assignTicket = useAssignTicket()
  const [selectedTech, setSelectedTech] = useState<string | null>(ticket.assignee?.id ?? null)
  const [reason, setReason] = useState('')
  const [showAll, setShowAll] = useState(false)

  const needsReason = ticket.status === 'ASSIGNED'
  const suggestions = suggestionsQuery.data ?? []
  const suggestedIds = new Set(suggestions.map((s) => s.technicianId))
  const others = (allTechniciansQuery.data?.data ?? []).filter(
    (t) => t.id !== ticket.assignee?.id && !suggestedIds.has(t.id),
  )

  const confirm = () => {
    if (!selectedTech) return
    if (needsReason && !reason.trim()) return

    assignTicket.mutate(
      {
        id: ticket.id,
        body: {
          technicianId: selectedTech,
          reason: needsReason ? reason.trim() : undefined,
          isAutoSuggested: suggestedIds.has(selectedTech),
        },
      },
      { onSuccess: onClose },
    )
  }

  return (
    <>
      <p className="mb-4 rounded-lg bg-moon-rose/25 px-3.5 py-2.5 text-sm text-moon-abyss/70">
        <span className="font-mono text-xs text-moon-abyss/70">{ticket.reference}</span>
        <span className="mx-2 text-moon-abyss/55">·</span>
        <span className="font-semibold text-moon-abyss">{ticket.title}</span>
      </p>

      {suggestionsQuery.isLoading && (
        <p className="text-sm text-moon-abyss/70">Chargement des suggestions…</p>
      )}
      {suggestionsQuery.isError && (
        <p className="text-sm text-rose-700">
          Impossible de charger les techniciens éligibles.
        </p>
      )}
      {!suggestionsQuery.isLoading && suggestions.length === 0 && (
        <p className="text-sm text-moon-abyss/70">
          Aucun technicien recommandé pour cette catégorie (compétence requise ou charge
          max). Vous pouvez tout de même en choisir un ci-dessous.
        </p>
      )}

      <div className="space-y-2">
        {suggestions.map((t) => {
          const name = displayPersonName(t.firstName, t.lastName, t.username)
          const selected = selectedTech === t.technicianId

          return (
            <button
              key={t.technicianId}
              type="button"
              onClick={() => setSelectedTech(t.technicianId)}
              className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors ${
                selected
                  ? 'border-moon-violet bg-moon-violet/5'
                  : 'border-moon-abyss/10 hover:border-moon-violet/40'
              }`}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-moon-lavande/15 text-xs font-bold text-moon-lavande">
                {initialsOf(name)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-moon-abyss">
                  {name}
                </span>
                <span className="text-xs text-moon-abyss/70">
                  {t.currentLoad}/{t.maxConcurrentTickets} tickets
                  {t.skillLevel != null ? ` · niveau ${t.skillLevel}` : ''}
                </span>
              </span>
              {selected && <Check size={16} className="shrink-0 text-moon-violet" />}
            </button>
          )
        })}
      </div>

      {others.length > 0 && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="flex items-center gap-1.5 text-xs font-semibold text-moon-violet"
          >
            <ChevronDown
              size={14}
              className={`transition-transform ${showAll ? 'rotate-180' : ''}`}
            />
            {showAll ? 'Masquer les autres techniciens' : `Voir tous les techniciens (${others.length})`}
          </button>

          {showAll && (
            <div className="mt-2 space-y-2">
              {others.map((t) => {
                const name = displayPersonName(t.firstName, t.lastName, t.username)
                const selected = selectedTech === t.id
                const reasonBlocked = eligibilityReason(t)
                const skillNames = t.skills.map((s) => s.name).join(', ')

                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSelectedTech(t.id)}
                    className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors ${
                      selected
                        ? 'border-moon-violet bg-moon-violet/5'
                        : 'border-moon-abyss/10 hover:border-moon-violet/40'
                    } ${reasonBlocked ? 'opacity-60' : ''}`}
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-moon-abyss/10 text-xs font-bold text-moon-abyss/70">
                      {initialsOf(name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-moon-abyss">
                        {name}
                      </span>
                      <span className="block text-xs text-moon-abyss/70">
                        {t.currentLoad}/{t.maxConcurrentTickets} tickets
                        {skillNames ? ` · ${skillNames}` : ' · aucune compétence enregistrée'}
                      </span>
                    </span>
                    {reasonBlocked && (
                      <span className="shrink-0 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-700">
                        {reasonBlocked}
                      </span>
                    )}
                    {selected && <Check size={16} className="shrink-0 text-moon-violet" />}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      {needsReason && (
        <div className="mt-4">
          <label htmlFor="assign-reason" className={ticketLabelClass}>
            Motif de réaffectation<RequiredMark />
          </label>
          <textarea
            id="assign-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            maxLength={REASON_MAX_LENGTH}
            className={`${ticketFieldClass} resize-none`}
            placeholder="Pourquoi changer de technicien ?"
          />
        </div>
      )}

      {assignTicket.isError && (
        <p className="mt-3 text-sm text-rose-700">
          {assignTicket.error instanceof Error
            ? assignTicket.error.message
            : 'Affectation impossible'}
        </p>
      )}

      <div className="mt-5 flex justify-end gap-2.5">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-moon-abyss/15 px-4 py-2.5 text-sm font-medium text-moon-abyss/70 hover:bg-moon-rose/20"
        >
          Annuler
        </button>
        <button
          type="button"
          onClick={confirm}
          disabled={
            !selectedTech ||
            selectedTech === ticket.assignee?.id ||
            (needsReason && !reason.trim()) ||
            assignTicket.isPending
          }
          className="rounded-lg bg-moon-violet-dark px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-moon-violet disabled:cursor-not-allowed disabled:opacity-40"
        >
          {assignTicket.isPending ? 'Envoi…' : "Confirmer l'affectation"}
        </button>
      </div>
    </>
  )
}
