import * as v from 'valibot'
import instance_api from '@/services/http/axios'
import {
  registerSchema,
  loginSchema,
  refreshTokenSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  updateMeSchema,
  type RegisterInput,
  type LoginInput,
  type RefreshTokenInput,
  type ForgotPasswordInput,
  type ResetPasswordInput,
  type UpdateMeInput,
} from '@/schema/auth.schema'
import type { AuthResponse, User } from '@/types/auth'

export const authService = {
  register: (body: RegisterInput): Promise<AuthResponse> => {
    return instance_api
      .post<AuthResponse>('/auth/register', v.parse(registerSchema, body))
      .then((r) => r.data)
  },

  login: (body: LoginInput): Promise<AuthResponse> => {
    return instance_api
      .post<AuthResponse>('/auth/login', v.parse(loginSchema, body))
      .then((r) => r.data)
  },

  refresh: (body: RefreshTokenInput): Promise<AuthResponse> => {
    return instance_api
      .post<AuthResponse>('/auth/refresh', v.parse(refreshTokenSchema, body))
      .then((r) => r.data)
  },

  forgotPassword: (body: ForgotPasswordInput): Promise<{ message?: string }> => {
    return instance_api
      .post<{ message?: string }>(
        '/auth/forgot-password',
        v.parse(forgotPasswordSchema, body),
      )
      .then((r) => r.data)
  },

  resetPassword: (body: ResetPasswordInput): Promise<void> => {
    return instance_api
      .post('/auth/reset-password', v.parse(resetPasswordSchema, body))
      .then(() => undefined)
  },

  logout: (body: RefreshTokenInput): Promise<void> => {
    return instance_api
      .post('/auth/logout', v.parse(refreshTokenSchema, body))
      .then(() => undefined)
  },

  me: (): Promise<User> => {
    return instance_api.get<User>('/auth/me').then((r) => r.data)
  },

  updateMe: (body: UpdateMeInput): Promise<User> => {
    return instance_api
      .patch<User>('/auth/me', v.parse(updateMeSchema, body))
      .then((r) => r.data)
  },
}
