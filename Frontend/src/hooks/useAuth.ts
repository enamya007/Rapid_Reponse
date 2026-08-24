'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { authService } from '@/services/auth.service'
import { authKeys } from '@/keys/auth.keys'
import type {
  RegisterInput,
  LoginInput,
  RefreshTokenInput,
  ForgotPasswordInput,
  ResetPasswordInput,
  UpdateMeInput,
} from '@/schema/auth.schema'

export const useMe = () =>
  useQuery({
    queryKey: authKeys.me(),
    queryFn: () => authService.me(),
  })

export const useUpdateMe = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (body: UpdateMeInput) => authService.updateMe(body),
    onSuccess: (data) => {
      queryClient.setQueryData(authKeys.me(), data)
    },
  })
}

export const useRegister = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (body: RegisterInput) => authService.register(body),
    onSuccess: (data) => {
      queryClient.setQueryData(authKeys.me(), data.user)
    },
  })
}

export const useLogin = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (body: LoginInput) => authService.login(body),
    onSuccess: (data) => {
      queryClient.setQueryData(authKeys.me(), data.user)
    },
  })
}

export const useRefresh = () =>
  useMutation({
    mutationFn: (body: RefreshTokenInput) => authService.refresh(body),
  })

export const useForgotPassword = () =>
  useMutation({
    mutationFn: (body: ForgotPasswordInput) => authService.forgotPassword(body),
  })

export const useResetPassword = () =>
  useMutation({
    mutationFn: (body: ResetPasswordInput) => authService.resetPassword(body),
  })

export const useLogout = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (body: RefreshTokenInput) => authService.logout(body),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: authKeys.all })
    },
  })
}
