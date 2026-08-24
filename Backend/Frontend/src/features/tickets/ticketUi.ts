import type { TicketPriority, TicketStatus } from '@/types/ticket'

export function canAssignStatus(status: TicketStatus) {
  return status === 'OPEN' || status === 'ASSIGNED'
}

export const statusStyles: Record<TicketStatus, string> = {
  OPEN: 'bg-moon-rose text-moon-violet-dark',
  ASSIGNED: 'bg-amber-100 text-amber-800',
  IN_PROGRESS: 'bg-moon-lavande/20 text-moon-lavande',
  RESOLVED: 'bg-emerald-100 text-emerald-800',
  CLOSED: 'bg-sky-100 text-sky-800',
  CANCELLED: 'bg-rose-100 text-rose-700',
}

export const statusLabels: Record<TicketStatus, string> = {
  OPEN: 'Ouvert',
  ASSIGNED: 'Affecté',
  IN_PROGRESS: 'En cours',
  RESOLVED: 'Résolu',
  CLOSED: 'Fermé',
  CANCELLED: 'Annulé',
}

export const priorityLabels: Record<TicketPriority, string> = {
  LOW: 'Basse',
  NORMAL: 'Moyenne',
  HIGH: 'Haute',
  CRITICAL: 'Urgente',
}

export const priorityDots: Record<TicketPriority, string> = {
  CRITICAL: 'bg-red-500',
  HIGH: 'bg-amber-500',
  NORMAL: 'bg-moon-lavande',
  LOW: 'bg-emerald-500',
}

export function displayPersonName(
  first: string | null | undefined,
  last: string | null | undefined,
  fallback: string,
) {
  const full = [first, last].filter(Boolean).join(' ').trim()
  return full || fallback
}

export function initialsOf(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

export function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export const ticketFieldClass =
  'w-full rounded-lg border border-moon-abyss/20 px-3.5 py-2.5 text-sm text-moon-abyss placeholder:text-moon-abyss/55 focus:border-moon-violet focus:outline-none'

export const ticketLabelClass =
  'mb-1.5 block font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-moon-abyss/70'
