import * as v from 'valibot'
import instance_api from '@/services/http/axios'
import {
  createSkillSchema,
  type CreateSkillInput,
} from '@/schema/skill.schema'
import type { Skill } from '@/types/skill'

export const skillsService = {
  findAll: (): Promise<Skill[]> => {
    return instance_api.get<Skill[]>('/skills').then((r) => r.data)
  },

  create: (body: CreateSkillInput): Promise<Skill> => {
    return instance_api
      .post<Skill>('/skills', v.parse(createSkillSchema, body))
      .then((r) => r.data)
  },
}
