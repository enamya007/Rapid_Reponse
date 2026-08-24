import type { CategoryListQuery } from '@/types/category'

export const categoriesKeys = {
  all: ['categories'] as const,
  lists: () => [...categoriesKeys.all, 'list'] as const,
  list: (params?: CategoryListQuery) =>
    [...categoriesKeys.lists(), params ?? {}] as const,
  details: () => [...categoriesKeys.all, 'detail'] as const,
  detail: (id: string) => [...categoriesKeys.details(), id] as const,
}
