export type TicketPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL'

export type TicketStatus =
  | 'OPEN'
  | 'ASSIGNED'
  | 'IN_PROGRESS'
  | 'RESOLVED'
  | 'CLOSED'
  | 'CANCELLED'

export type UserSummary = {
  id: string
  username: string
  firstName: string | null
  lastName: string | null
}

export type TicketCategorySummary = {
  id: string
  name: string
}

export type TicketListAssigneeSummary = {
  id: string
  username: string
}

export type TicketListItem = {
  id: string
  reference: string
  title: string
  status: TicketStatus
  priority: TicketPriority
  category: TicketCategorySummary
  assignee: TicketListAssigneeSummary | null
  slaDueAt: string | null
  createdAt: string
}

export type Ticket = {
  id: string
  reference: string
  title: string
  description: string
  status: TicketStatus
  priority: TicketPriority
  category: TicketCategorySummary
  createdBy: UserSummary
  assignee: UserSummary | null
  siteLabel: string | null
  siteAddress: string | null
  slaDueAt: string | null
  assignedAt: string | null
  startedAt: string | null
  resolvedAt: string | null
  closedAt: string | null
  cancelledAt: string | null
  resolutionNote: string | null
  createdAt: string
  updatedAt: string
}

export type TechnicianSuggestion = {
  technicianId: string
  username: string
  firstName: string | null
  lastName: string | null
  skillLevel: number | null
  currentLoad: number
  maxConcurrentTickets: number
}

export type AssignmentActorSummary = {
  id: string
  username: string
}

export type TicketAssignment = {
  id: string
  technician: AssignmentActorSummary
  assignedBy: AssignmentActorSummary | null
  reason: string | null
  isAutoSuggested: boolean
  assignedAt: string
  unassignedAt: string | null
}

export type TicketSortField = 'createdAt' | 'priority' | 'slaDueAt' | 'status'
export type SortOrder = 'ASC' | 'DESC'

export type TicketListQuery = {
  page?: number
  limit?: number
  status?: TicketStatus
  priority?: TicketPriority
  categoryId?: string
  assigneeId?: string
  createdById?: string
  q?: string
  sort?: TicketSortField
  order?: SortOrder
}
