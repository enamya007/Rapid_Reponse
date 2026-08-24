'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { notificationsService } from '@/services/notifications.service'
import { notificationsKeys } from '@/keys/notifications.keys'
import type { NotificationListQuery } from '@/types/notification'

export const useNotifications = (
  params?: NotificationListQuery,
  options?: { enabled?: boolean },
) =>
  useQuery({
    queryKey: notificationsKeys.list(params),
    queryFn: () => notificationsService.list(params),
    enabled: options?.enabled ?? true,
  })

export const useUnreadCount = () =>
  useQuery({
    queryKey: notificationsKeys.unreadCount(),
    queryFn: () => notificationsService.unreadCount(),
  })

export const useReadAllNotifications = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => notificationsService.readAll(),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: notificationsKeys.all }),
  })
}

export const useMarkNotificationRead = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => notificationsService.markRead(id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: notificationsKeys.all }),
  })
}
