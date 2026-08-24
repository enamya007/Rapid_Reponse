import * as v from 'valibot'
import { phoneSchema } from '@/schema/phone.schema'

export const technicianSkillInputSchema = v.object({
  skillId: v.pipe(
    v.string('La compétence est requise'),
    v.nonEmpty('La compétence est requise'),
    v.uuid('Identifiant invalide'),
  ),
  level: v.optional(
    v.pipe(
      v.number('Le niveau est invalide'),
      v.minValue(1, 'Le niveau doit être ≥ 1'),
      v.maxValue(5, 'Le niveau doit être ≤ 5'),
    ),
  ),
})

export type TechnicianSkillInput = v.InferInput<typeof technicianSkillInputSchema>

export const createTechnicianSchema = v.object({
  username: v.pipe(
    v.string("Le nom d'utilisateur est requis"),
    v.nonEmpty("Le nom d'utilisateur est requis"),
    v.minLength(3, "Le nom d'utilisateur doit contenir au moins 3 caractères"),
    v.maxLength(50, "Le nom d'utilisateur ne doit pas dépasser 50 caractères"),
  ),
  email: v.pipe(
    v.string("L'adresse e-mail est requise"),
    v.nonEmpty("L'adresse e-mail est requise"),
    v.email('Adresse email invalide'),
  ),
  password: v.pipe(
    v.string('Le mot de passe est requis'),
    v.nonEmpty('Le mot de passe est requis'),
    v.minLength(10, 'Le mot de passe doit contenir au moins 10 caractères'),
    v.maxLength(72, 'Le mot de passe ne doit pas dépasser 72 caractères'),
  ),
  firstName: v.optional(
    v.pipe(
      v.string('Le prénom est invalide'),
      v.maxLength(80, 'Le prénom ne doit pas dépasser 80 caractères'),
    ),
  ),
  lastName: v.optional(
    v.pipe(
      v.string('Le nom est invalide'),
      v.maxLength(80, 'Le nom ne doit pas dépasser 80 caractères'),
    ),
  ),
  phone: phoneSchema,
  isAvailable: v.optional(v.boolean('La disponibilité est invalide')),
  maxConcurrentTickets: v.optional(
    v.pipe(
      v.number('La charge max est invalide'),
      v.minValue(1, 'La charge max doit être ≥ 1'),
      v.maxValue(50, 'La charge max doit être ≤ 50'),
    ),
  ),
  skills: v.optional(
    v.array(technicianSkillInputSchema, 'Les compétences sont invalides'),
  ),
})

export type CreateTechnicianInput = v.InferInput<typeof createTechnicianSchema>

export const updateTechnicianSchema = v.object({
  isAvailable: v.optional(v.boolean('La disponibilité est invalide')),
  maxConcurrentTickets: v.optional(
    v.pipe(
      v.number('La charge max est invalide'),
      v.minValue(1, 'La charge max doit être ≥ 1'),
      v.maxValue(50, 'La charge max doit être ≤ 50'),
    ),
  ),
  isActive: v.optional(v.boolean('Le statut actif est invalide')),
})

export type UpdateTechnicianInput = v.InferInput<typeof updateTechnicianSchema>

export const updateAvailabilitySchema = v.object({
  isAvailable: v.boolean('La disponibilité est requise'),
})

export type UpdateAvailabilityInput = v.InferInput<typeof updateAvailabilitySchema>

export const setTechnicianSkillsSchema = v.object({
  skills: v.array(technicianSkillInputSchema, 'Les compétences sont requises'),
})

export type SetTechnicianSkillsInput = v.InferInput<typeof setTechnicianSkillsSchema>
