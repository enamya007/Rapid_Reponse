import type { PaginationQuery } from '@/types/common'
import type { TicketListQuery } from '@/types/ticket'

export const ticketsKeys = {
  all: ['tickets'] as const,
  lists: () => [...ticketsKeys.all, 'list'] as const,
  list: (params?: TicketListQuery) =>
    [...ticketsKeys.lists(), params ?? {}] as const,
  details: () => [...ticketsKeys.all, 'detail'] as const,
  detail: (id: string) => [...ticketsKeys.details(), id] as const,
  comments: (id: string, params?: PaginationQuery) =>
    [...ticketsKeys.detail(id), 'comments', params ?? {}] as const,
  suggestions: (id: string) =>
    [...ticketsKeys.detail(id), 'suggestions'] as const,
  assignments: (id: string) =>
    [...ticketsKeys.detail(id), 'assignments'] as const,
}
