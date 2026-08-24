export const attachmentsKeys = {
  all: ['attachments'] as const,
  byTicket: (ticketId: string) =>
    [...attachmentsKeys.all, 'ticket', ticketId] as const,
}
