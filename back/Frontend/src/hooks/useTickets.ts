'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ticketsService } from '@/services/tickets.service'
import { ticketsKeys } from '@/keys/tickets.keys'
import type {
  CreateTicketInput,
  UpdateTicketInput,
  ResolveTicketInput,
  ReasonInput,
  AssignTicketInput,
  CreateCommentInput,
} from '@/schema/ticket.schema'
import type { PaginationQuery } from '@/types/common'
import type { TicketListQuery } from '@/types/ticket'

export const useTickets = (params?: TicketListQuery) =>
  useQuery({
    queryKey: ticketsKeys.list(params),
    queryFn: () => ticketsService.list(params),
  })

export const useTicket = (id: string) =>
  useQuery({
    queryKey: ticketsKeys.detail(id),
    queryFn: () => ticketsService.getById(id),
    enabled: Boolean(id),
  })

export const useCreateTicket = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (body: CreateTicketInput) => ticketsService.create(body),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ticketsKeys.lists() }),
  })
}

export const useUpdateTicket = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateTicketInput }) =>
      ticketsService.update(id, body),
    onSuccess: (data, { id }) => {
      queryClient.setQueryData(ticketsKeys.detail(id), data)
      queryClient.invalidateQueries({ queryKey: ticketsKeys.lists() })
    },
  })
}

export const useDeleteTicket = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => ticketsService.remove(id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ticketsKeys.lists() }),
  })
}

export const useStartTicket = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => ticketsService.start(id),
    onSuccess: (data) => {
      queryClient.setQueryData(ticketsKeys.detail(data.id), data)
      queryClient.invalidateQueries({ queryKey: ticketsKeys.lists() })
    },
  })
}

export const useResolveTicket = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ResolveTicketInput }) =>
      ticketsService.resolve(id, body),
    onSuccess: (data) => {
      queryClient.setQueryData(ticketsKeys.detail(data.id), data)
      queryClient.invalidateQueries({ queryKey: ticketsKeys.lists() })
    },
  })
}

export const useReopenTicket = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ReasonInput }) =>
      ticketsService.reopen(id, body),
    onSuccess: (data) => {
      queryClient.setQueryData(ticketsKeys.detail(data.id), data)
      queryClient.invalidateQueries({ queryKey: ticketsKeys.lists() })
    },
  })
}

export const useCloseTicket = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => ticketsService.close(id),
    onSuccess: (data) => {
      queryClient.setQueryData(ticketsKeys.detail(data.id), data)
      queryClient.invalidateQueries({ queryKey: ticketsKeys.lists() })
    },
  })
}

export const useCancelTicket = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ReasonInput }) =>
      ticketsService.cancel(id, body),
    onSuccess: (data) => {
      queryClient.setQueryData(ticketsKeys.detail(data.id), data)
      queryClient.invalidateQueries({ queryKey: ticketsKeys.lists() })
    },
  })
}

export const useAssignmentSuggestions = (
  id: string,
  options?: { enabled?: boolean },
) =>
  useQuery({
    queryKey: ticketsKeys.suggestions(id),
    queryFn: () => ticketsService.getAssignmentSuggestions(id),
    enabled: Boolean(id) && (options?.enabled ?? true),
  })

export const useAssignTicket = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: AssignTicketInput }) =>
      ticketsService.assign(id, body),
    onSuccess: (data) => {
      queryClient.setQueryData(ticketsKeys.detail(data.id), data)
      queryClient.invalidateQueries({ queryKey: ticketsKeys.lists() })
      queryClient.invalidateQueries({ queryKey: ticketsKeys.assignments(data.id) })
    },
  })
}

export const useAssignmentHistory = (id: string) =>
  useQuery({
    queryKey: ticketsKeys.assignments(id),
    queryFn: () => ticketsService.getAssignmentHistory(id),
    enabled: Boolean(id),
  })

export const useTicketComments = (id: string, params?: PaginationQuery) =>
  useQuery({
    queryKey: ticketsKeys.comments(id, params),
    queryFn: () => ticketsService.listComments(id, params),
    enabled: Boolean(id),
  })

export const useCreateComment = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: CreateCommentInput }) =>
      ticketsService.createComment(id, body),
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({
        queryKey: [...ticketsKeys.detail(id), 'comments'],
      })
    },
  })
}
