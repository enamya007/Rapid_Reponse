'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { usersService } from '@/services/users.service'
import { usersKeys } from '@/keys/users.keys'
import { authKeys } from '@/keys/auth.keys'
import type { CreateUserInput, UpdateUserInput } from '@/schema/user.schema'
import type { UserListQuery } from '@/types/auth'

export const useUsers = (params?: UserListQuery, options?: { enabled?: boolean }) =>
  useQuery({
    queryKey: usersKeys.list(params),
    queryFn: () => usersService.list(params),
    enabled: options?.enabled ?? true,
  })

export const useUser = (id: string) =>
  useQuery({
    queryKey: usersKeys.detail(id),
    queryFn: () => usersService.getById(id),
    enabled: Boolean(id),
  })

export const useCreateUser = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (body: CreateUserInput) => usersService.create(body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: usersKeys.lists() }),
  })
}

export const useUpdateUser = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateUserInput }) =>
      usersService.update(id, body),
    onSuccess: (data, { id }) => {
      queryClient.setQueryData(usersKeys.detail(id), data)
      queryClient.invalidateQueries({ queryKey: usersKeys.lists() })
      queryClient.invalidateQueries({ queryKey: authKeys.me() })
    },
  })
}

export const useDeleteUser = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => usersService.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: usersKeys.lists() }),
  })
}
