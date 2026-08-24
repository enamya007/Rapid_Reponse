import instance_api from '@/services/http/axios'
import type {
  Notification,
  NotificationListQuery,
  UnreadCount,
} from '@/types/notification'
import type { Paginated } from '@/types/common'

export const notificationsService = {
  list: (
    params?: NotificationListQuery,
  ): Promise<Paginated<Notification>> => {
    return instance_api
      .get<Paginated<Notification>>('/notifications', { params })
      .then((r) => r.data)
  },

  unreadCount: (): Promise<UnreadCount> => {
    return instance_api
      .get<UnreadCount>('/notifications/unread-count')
      .then((r) => r.data)
  },

  readAll: (): Promise<void> => {
    return instance_api.patch('/notifications/read-all').then(() => undefined)
  },

  markRead: (id: string): Promise<void> => {
    return instance_api
      .patch(`/notifications/${id}/read`)
      .then(() => undefined)
  },
}
