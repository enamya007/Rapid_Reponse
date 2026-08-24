import * as v from 'valibot'

export const createSkillSchema = v.object({
  name: v.pipe(
    v.string('Le nom est requis'),
    v.nonEmpty('Le nom est requis'),
    v.minLength(2, 'Le nom doit contenir au moins 2 caractères'),
    v.maxLength(80, 'Le nom ne doit pas dépasser 80 caractères'),
  ),
  description: v.optional(
    v.pipe(
      v.string('La description est invalide'),
      v.maxLength(2000, 'La description ne doit pas dépasser 2000 caractères'),
    ),
  ),
})

export type CreateSkillInput = v.InferInput<typeof createSkillSchema>
