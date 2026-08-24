import type { TechnicianListQuery } from '@/types/technician'

export const techniciansKeys = {
  all: ['technicians'] as const,
  lists: () => [...techniciansKeys.all, 'list'] as const,
  list: (params?: TechnicianListQuery) =>
    [...techniciansKeys.lists(), params ?? {}] as const,
  details: () => [...techniciansKeys.all, 'detail'] as const,
  detail: (id: string) => [...techniciansKeys.details(), id] as const,
}
