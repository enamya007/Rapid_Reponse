'use client'

import { useRef } from 'react'
import { useAttachments, useUploadAttachment, useDeleteAttachment } from '@/hooks/useAttachments'
import type { UserRole } from '@/types/auth'

export default function TicketAttachments({
  ticketId,
  role,
}: {
  ticketId: string
  role: UserRole | undefined
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const listQuery = useAttachments(ticketId)
  const upload = useUploadAttachment()
  const remove = useDeleteAttachment()
  const files = listQuery.data ?? []
  const canDelete = role === 'ADMIN' || role === 'CLIENT' || role === 'TECHNICIAN'

  return (
    <div className="rounded-2xl border border-moon-abyss/15 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-bold text-moon-violet-dark">Pièces jointes</h2>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={upload.isPending}
          className="rounded-lg border border-moon-violet/25 px-3 py-1.5 text-xs font-medium text-moon-violet hover:bg-moon-violet hover:text-white disabled:opacity-40"
        >
          {upload.isPending ? 'Envoi…' : 'Ajouter un fichier'}
        </button>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) upload.mutate({ id: ticketId, file })
            e.target.value = ''
          }}
        />
      </div>

      {listQuery.isLoading && (
        <p className="mt-3 text-sm text-moon-abyss/70">Chargement…</p>
      )}
      {listQuery.isError && (
        <p className="mt-3 text-sm text-rose-700">Impossible de charger les fichiers.</p>
      )}
      {upload.isError && (
        <p className="mt-3 text-sm text-rose-700">
          {upload.error instanceof Error ? upload.error.message : 'Upload impossible'}
        </p>
      )}
      {remove.isError && (
        <p className="mt-3 text-sm text-rose-700">
          {remove.error instanceof Error ? remove.error.message : 'Suppression impossible'}
        </p>
      )}

      <ul className="mt-4 space-y-2">
        {files.map((f) => (
          <li
            key={f.id}
            className="flex items-center justify-between gap-3 rounded-lg bg-moon-rose/15 px-3 py-2 text-sm"
          >
            {f.downloadUrl ? (
              <a
                href={f.downloadUrl}
                target="_blank"
                rel="noreferrer"
                className="truncate font-medium text-moon-violet hover:underline"
              >
                {f.originalName}
              </a>
            ) : (
              <span className="truncate text-moon-abyss">{f.originalName}</span>
            )}
            {canDelete && (
              <button
                type="button"
                onClick={() => remove.mutate({ id: ticketId, attId: f.id })}
                className="shrink-0 text-xs text-rose-700 hover:underline"
              >
                Supprimer
              </button>
            )}
          </li>
        ))}
        {!listQuery.isLoading && files.length === 0 && (
          <li className="text-sm text-moon-abyss/70">Aucune pièce jointe.</li>
        )}
      </ul>
    </div>
  )
}
