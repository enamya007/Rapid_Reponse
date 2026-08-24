export type NotificationType =
  | 'TICKET_CREATED'
  | 'TICKET_ASSIGNED'
  | 'TICKET_STATUS_CHANGED'
  | 'TICKET_COMMENTED'
  | 'TICKET_SLA_BREACHED'

export type Notification = {
  id: string
  type: NotificationType
  title: string
  body: string
  payload: Record<string, unknown> | null
  ticketId: string | null
  ticketReference: string | null
  readAt: string | null
  createdAt: string
}

export type UnreadCount = {
  count: number
}

export type NotificationListQuery = {
  page?: number
  limit?: number
  unreadOnly?: boolean
}
