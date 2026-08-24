'use client'

import { useState } from 'react'
import { useTicketComments, useCreateComment } from '@/hooks/useTickets'
import type { UserRole } from '@/types/auth'
import type { CommentVisibility } from '@/types/comment'
import { formatDate, ticketFieldClass, ticketLabelClass } from '@/features/tickets/ticketUi'
import RequiredMark from '@/components/RequiredMark'
import { COMMENT_BODY_MAX_LENGTH } from '@/lib/validators'

export default function TicketComments({
  ticketId,
  role,
}: {
  ticketId: string
  role: UserRole | undefined
}) {
  const commentsQuery = useTicketComments(ticketId, { page: 1, limit: 50 })
  const createComment = useCreateComment()
  const comments = commentsQuery.data?.data ?? []
  const [body, setBody] = useState('')
  const [visibility, setVisibility] = useState<CommentVisibility>('PUBLIC')
  const canInternal = role === 'ADMIN' || role === 'TECHNICIAN'

  const submit = () => {
    if (!body.trim()) return
    createComment.mutate(
      {
        id: ticketId,
        body: {
          body: body.trim(),
          visibility: canInternal ? visibility : 'PUBLIC',
        },
      },
      { onSuccess: () => setBody('') },
    )
  }

  return (
    <div className="rounded-2xl border border-moon-abyss/15 bg-white p-5 shadow-sm">
      <h2 className="font-bold text-moon-violet-dark">Commentaires</h2>
      {role !== 'CLIENT' && (
        <p className="text-xs text-moon-abyss/70">
          Les commentaires internes ne sont pas visibles par le client.
        </p>
      )}

      {commentsQuery.isLoading && (
        <p className="mt-3 text-sm text-moon-abyss/70">Chargement…</p>
      )}
      {commentsQuery.isError && (
        <p className="mt-3 text-sm text-rose-700">Impossible de charger les commentaires.</p>
      )}

      <ul className="mt-4 space-y-3">
        {comments.map((c) => (
          <li key={c.id} className="rounded-xl bg-moon-rose/15 px-3.5 py-3">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-moon-abyss">
                {c.author?.username ?? 'Compte supprimé'}
              </span>
              <span className="font-mono text-[11px] text-moon-abyss/65">
                {formatDate(c.createdAt)}
                {c.visibility === 'INTERNAL' ? ' · interne' : ''}
              </span>
            </div>
            <p className="whitespace-pre-wrap text-sm text-moon-abyss/80">{c.body}</p>
          </li>
        ))}
        {!commentsQuery.isLoading && comments.length === 0 && (
          <li className="text-sm text-moon-abyss/70">Aucun commentaire.</li>
        )}
      </ul>

      <div className="mt-4 space-y-3">
        {canInternal && (
          <div>
            <label htmlFor="comment-visibility" className={ticketLabelClass}>
              Visibilité
            </label>
            <select
              id="comment-visibility"
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as CommentVisibility)}
              className={ticketFieldClass}
            >
              <option value="PUBLIC">Public (visible du client)</option>
              <option value="INTERNAL">Interne</option>
            </select>
          </div>
        )}
        <label htmlFor="comment-body" className={ticketLabelClass}>
          Nouveau commentaire<RequiredMark />
        </label>
        <textarea
          id="comment-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          maxLength={COMMENT_BODY_MAX_LENGTH}
          className={`${ticketFieldClass} resize-none`}
          placeholder="Écrire un commentaire…"
        />
        {createComment.isError && (
          <p className="text-sm text-rose-700">
            {createComment.error instanceof Error
              ? createComment.error.message
              : 'Envoi impossible'}
          </p>
        )}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={submit}
            disabled={!body.trim() || createComment.isPending}
            className="rounded-lg bg-moon-violet-dark px-4 py-2.5 text-sm font-medium text-white hover:bg-moon-violet disabled:opacity-40"
          >
            {createComment.isPending ? 'Envoi…' : 'Publier'}
          </button>
        </div>
      </div>
    </div>
  )
}
