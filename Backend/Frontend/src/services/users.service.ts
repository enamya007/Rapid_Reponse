import * as v from 'valibot'
import instance_api from '@/services/http/axios'
import {
  createUserSchema,
  updateUserSchema,
  type CreateUserInput,
  type UpdateUserInput,
} from '@/schema/user.schema'
import type { Paginated } from '@/types/common'
import type { User, UserListQuery } from '@/types/auth'

export const usersService = {
  list: (params?: UserListQuery): Promise<Paginated<User>> => {
    return instance_api.get<Paginated<User>>('/users', { params }).then((r) => r.data)
  },

  create: (body: CreateUserInput): Promise<User> => {
    return instance_api
      .post<User>('/users', v.parse(createUserSchema, body))
      .then((r) => r.data)
  },

  getById: (id: string): Promise<User> => {
    return instance_api.get<User>(`/users/${id}`).then((r) => r.data)
  },

  update: (id: string, body: UpdateUserInput): Promise<User> => {
    return instance_api
      .patch<User>(`/users/${id}`, v.parse(updateUserSchema, body))
      .then((r) => r.data)
  },

  remove: (id: string): Promise<void> => {
    return instance_api.delete(`/users/${id}`).then(() => undefined)
  },
}
