import type { UserListQuery } from '@/types/auth'

export const usersKeys = {
  all: ['users'] as const,
  lists: () => [...usersKeys.all, 'list'] as const,
  list: (params?: UserListQuery) => [...usersKeys.lists(), params ?? {}] as const,
  details: () => [...usersKeys.all, 'detail'] as const,
  detail: (id: string) => [...usersKeys.details(), id] as const,
}
