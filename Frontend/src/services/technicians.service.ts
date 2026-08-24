import * as v from 'valibot'
import instance_api from '@/services/http/axios'
import {
  createTechnicianSchema,
  updateTechnicianSchema,
  updateAvailabilitySchema,
  setTechnicianSkillsSchema,
  type CreateTechnicianInput,
  type UpdateTechnicianInput,
  type UpdateAvailabilityInput,
  type SetTechnicianSkillsInput,
} from '@/schema/technician.schema'
import type { Paginated } from '@/types/common'
import type { Technician, TechnicianListQuery } from '@/types/technician'

export const techniciansService = {
  list: (params?: TechnicianListQuery): Promise<Paginated<Technician>> => {
    return instance_api
      .get<Paginated<Technician>>('/technicians', { params })
      .then((r) => r.data)
  },

  create: (body: CreateTechnicianInput): Promise<Technician> => {
    return instance_api
      .post<Technician>('/technicians', v.parse(createTechnicianSchema, body))
      .then((r) => r.data)
  },

  updateMyAvailability: (
    body: UpdateAvailabilityInput,
  ): Promise<Technician> => {
    return instance_api
      .patch<Technician>(
        '/technicians/me/availability',
        v.parse(updateAvailabilitySchema, body),
      )
      .then((r) => r.data)
  },

  getById: (id: string): Promise<Technician> => {
    return instance_api
      .get<Technician>(`/technicians/${id}`)
      .then((r) => r.data)
  },

  update: (id: string, body: UpdateTechnicianInput): Promise<Technician> => {
    return instance_api
      .patch<Technician>(
        `/technicians/${id}`,
        v.parse(updateTechnicianSchema, body),
      )
      .then((r) => r.data)
  },

  setSkills: (
    id: string,
    body: SetTechnicianSkillsInput,
  ): Promise<Technician> => {
    return instance_api
      .put<Technician>(
        `/technicians/${id}/skills`,
        v.parse(setTechnicianSkillsSchema, body),
      )
      .then((r) => r.data)
  },
}
