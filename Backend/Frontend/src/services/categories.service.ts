import * as v from 'valibot'
import instance_api from '@/services/http/axios'
import {
  createCategorySchema,
  updateCategorySchema,
  type CreateCategoryInput,
  type UpdateCategoryInput,
} from '@/schema/category.schema'
import type { Category, CategoryListQuery } from '@/types/category'

export const categoriesService = {
  list: (params?: CategoryListQuery): Promise<Category[]> => {
    return instance_api.get<Category[]>('/categories', { params }).then((r) => r.data)
  },

  create: (body: CreateCategoryInput): Promise<Category> => {
    return instance_api
      .post<Category>('/categories', v.parse(createCategorySchema, body))
      .then((r) => r.data)
  },

  getById: (id: string): Promise<Category> => {
    return instance_api.get<Category>(`/categories/${id}`).then((r) => r.data)
  },

  update: (id: string, body: UpdateCategoryInput): Promise<Category> => {
    return instance_api
      .patch<Category>(`/categories/${id}`, v.parse(updateCategorySchema, body))
      .then((r) => r.data)
  },
}
