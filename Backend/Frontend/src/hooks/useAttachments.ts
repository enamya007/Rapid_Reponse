'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { attachmentsService } from '@/services/attachments.service'
import { attachmentsKeys } from '@/keys/attachments.keys'

export const useAttachments = (ticketId: string) =>
  useQuery({
    queryKey: attachmentsKeys.byTicket(ticketId),
    queryFn: () => attachmentsService.list(ticketId),
    enabled: Boolean(ticketId),
  })

export const useUploadAttachment = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) =>
      attachmentsService.upload(id, file),
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: attachmentsKeys.byTicket(id) })
    },
  })
}

export const useDeleteAttachment = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, attId }: { id: string; attId: string }) =>
      attachmentsService.remove(id, attId),
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: attachmentsKeys.byTicket(id) })
    },
  })
}
