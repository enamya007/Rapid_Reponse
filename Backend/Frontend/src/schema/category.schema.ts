import * as v from 'valibot'

export const createCategorySchema = v.object({
  name: v.pipe(
    v.string('Le nom est requis'),
    v.nonEmpty('Le nom est requis'),
    v.minLength(2, 'Le nom doit contenir au moins 2 caractères'),
    v.maxLength(80, 'Le nom ne doit pas dépasser 80 caractères'),
  ),
  description: v.optional(
    v.pipe(
      v.string('La description est invalide'),
      v.maxLength(2000, 'Trop long'),
    ),
  ),
  requiredSkillId: v.optional(
    v.pipe(v.string('La compétence est invalide'), v.uuid('Identifiant invalide')),
  ),
})

export type CreateCategoryInput = v.InferInput<typeof createCategorySchema>

export const updateCategorySchema = v.object({
  name: v.optional(
    v.pipe(
      v.string('Le nom est invalide'),
      v.minLength(2, 'Le nom doit contenir au moins 2 caractères'),
      v.maxLength(80, 'Le nom ne doit pas dépasser 80 caractères'),
    ),
  ),
  description: v.optional(
    v.pipe(
      v.string('La description est invalide'),
      v.maxLength(2000, 'La description ne doit pas dépasser 2000 caractères'),
    ),
  ),
  requiredSkillId: v.optional(
    v.nullable(v.pipe(v.string('La compétence est invalide'), v.uuid('Identifiant invalide'))),
  ),
  isActive: v.optional(v.boolean('Le statut actif est invalide')),
})

export type UpdateCategoryInput = v.InferInput<typeof updateCategorySchema>
