import * as v from 'valibot'
import instance_api from '@/services/http/axios'
import {
  createTicketSchema,
  updateTicketSchema,
  resolveTicketSchema,
  reasonSchema,
  assignTicketSchema,
  createCommentSchema,
  type CreateTicketInput,
  type UpdateTicketInput,
  type ResolveTicketInput,
  type ReasonInput,
  type AssignTicketInput,
  type CreateCommentInput,
} from '@/schema/ticket.schema'
import type { Paginated, PaginationQuery } from '@/types/common'
import type { Comment } from '@/types/comment'
import type {
  Ticket,
  TicketAssignment,
  TicketListItem,
  TicketListQuery,
  TechnicianSuggestion,
} from '@/types/ticket'

export const ticketsService = {
  list: (params?: TicketListQuery): Promise<Paginated<TicketListItem>> => {
    return instance_api
      .get<Paginated<TicketListItem>>('/tickets', { params })
      .then((r) => r.data)
  },

  create: (body: CreateTicketInput): Promise<Ticket> => {
    return instance_api
      .post<Ticket>('/tickets', v.parse(createTicketSchema, body))
      .then((r) => r.data)
  },

  getById: (id: string): Promise<Ticket> => {
    return instance_api.get<Ticket>(`/tickets/${id}`).then((r) => r.data)
  },

  update: (id: string, body: UpdateTicketInput): Promise<Ticket> => {
    return instance_api
      .patch<Ticket>(`/tickets/${id}`, v.parse(updateTicketSchema, body))
      .then((r) => r.data)
  },

  remove: (id: string): Promise<void> => {
    return instance_api.delete(`/tickets/${id}`).then(() => undefined)
  },

  start: (id: string): Promise<Ticket> => {
    return instance_api.post<Ticket>(`/tickets/${id}/start`).then((r) => r.data)
  },

  resolve: (id: string, body: ResolveTicketInput): Promise<Ticket> => {
    return instance_api
      .post<Ticket>(`/tickets/${id}/resolve`, v.parse(resolveTicketSchema, body))
      .then((r) => r.data)
  },

  reopen: (id: string, body: ReasonInput): Promise<Ticket> => {
    return instance_api
      .post<Ticket>(`/tickets/${id}/reopen`, v.parse(reasonSchema, body))
      .then((r) => r.data)
  },

  close: (id: string): Promise<Ticket> => {
    return instance_api.post<Ticket>(`/tickets/${id}/close`).then((r) => r.data)
  },

  cancel: (id: string, body: ReasonInput): Promise<Ticket> => {
    return instance_api
      .post<Ticket>(`/tickets/${id}/cancel`, v.parse(reasonSchema, body))
      .then((r) => r.data)
  },

  getAssignmentSuggestions: (
    id: string,
    params?: { limit?: number },
  ): Promise<TechnicianSuggestion[]> => {
    return instance_api
      .get<TechnicianSuggestion[]>(`/tickets/${id}/assignment-suggestions`, {
        params,
      })
      .then((r) => r.data)
  },

  assign: (id: string, body: AssignTicketInput): Promise<Ticket> => {
    return instance_api
      .post<Ticket>(`/tickets/${id}/assign`, v.parse(assignTicketSchema, body))
      .then((r) => r.data)
  },

  getAssignmentHistory: (id: string): Promise<TicketAssignment[]> => {
    return instance_api
      .get<TicketAssignment[]>(`/tickets/${id}/assignments`)
      .then((r) => r.data)
  },

  listComments: (
    id: string,
    params?: PaginationQuery,
  ): Promise<Paginated<Comment>> => {
    return instance_api
      .get<Paginated<Comment>>(`/tickets/${id}/comments`, { params })
      .then((r) => r.data)
  },

  createComment: (id: string, body: CreateCommentInput): Promise<Comment> => {
    return instance_api
      .post<Comment>(
        `/tickets/${id}/comments`,
        v.parse(createCommentSchema, body),
      )
      .then((r) => r.data)
  },
}
