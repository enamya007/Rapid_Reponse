import instance_api from '@/services/http/axios'
import type { Attachment } from '@/types/attachment'

export const attachmentsService = {
  list: (id: string): Promise<Attachment[]> => {
    return instance_api
      .get<Attachment[]>(`/tickets/${id}/attachments`)
      .then((r) => r.data)
  },

  upload: (id: string, file: File): Promise<Attachment> => {
    const formData = new FormData()
    formData.append('file', file)

    return instance_api
      .post<Attachment>(`/tickets/${id}/attachments`, formData)
      .then((r) => r.data)
  },

  remove: (id: string, attId: string): Promise<void> => {
    return instance_api
      .delete(`/tickets/${id}/attachments/${attId}`)
      .then(() => undefined)
  },
}
