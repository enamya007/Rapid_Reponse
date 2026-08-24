'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { categoriesService } from '@/services/categories.service'
import { categoriesKeys } from '@/keys/categories.keys'
import type { CreateCategoryInput, UpdateCategoryInput } from '@/schema/category.schema'
import type { CategoryListQuery } from '@/types/category'

export const useCategories = (
  params?: CategoryListQuery,
  options?: { enabled?: boolean },
) =>
  useQuery({
    queryKey: categoriesKeys.list(params),
    queryFn: () => categoriesService.list(params),
    enabled: options?.enabled ?? true,
  })

export const useCreateCategory = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (body: CreateCategoryInput) => categoriesService.create(body),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: categoriesKeys.lists() }),
  })
}

export const useUpdateCategory = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateCategoryInput }) =>
      categoriesService.update(id, body),
    onSuccess: (data, { id }) => {
      queryClient.setQueryData(categoriesKeys.detail(id), data)
      queryClient.invalidateQueries({ queryKey: categoriesKeys.lists() })
    },
  })
}
