import type { NotificationListQuery } from '@/types/notification'

export const notificationsKeys = {
  all: ['notifications'] as const,
  lists: () => [...notificationsKeys.all, 'list'] as const,
  list: (params?: NotificationListQuery) =>
    [...notificationsKeys.lists(), params ?? {}] as const,
  unreadCount: () => [...notificationsKeys.all, 'unread-count'] as const,
}
