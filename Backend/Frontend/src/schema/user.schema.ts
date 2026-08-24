import * as v from 'valibot'
import type { UserRole } from '@/types/auth'
import { phoneSchema } from '@/schema/phone.schema'

const adminAssignableRoleSchema = v.picklist(
  ['ADMIN', 'CLIENT'] as const,
  'Le rôle doit être ADMIN ou CLIENT (les techniciens se créent via /technicians)',
)

const strongPassword = v.pipe(
  v.string('Le mot de passe est requis'),
  v.nonEmpty('Le mot de passe est requis'),
  v.minLength(10, 'Le mot de passe doit contenir au moins 10 caractères'),
  v.maxLength(72, 'Le mot de passe ne doit pas dépasser 72 caractères'),
  v.regex(
    /(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
    'Le mot de passe doit contenir une minuscule, une majuscule et un chiffre',
  ),
)

export const createUserSchema = v.object({
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
  password: strongPassword,
  role: v.optional(adminAssignableRoleSchema),
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
})

export type CreateUserInput = v.InferInput<typeof createUserSchema>
export type AdminAssignableRole = Extract<UserRole, 'ADMIN' | 'CLIENT'>

export const updateUserSchema = v.object({
  username: v.optional(
    v.pipe(
      v.string("Le nom d'utilisateur est invalide"),
      v.minLength(3, "Le nom d'utilisateur doit contenir au moins 3 caractères"),
      v.maxLength(50, "Le nom d'utilisateur ne doit pas dépasser 50 caractères"),
    ),
  ),
  email: v.optional(
    v.pipe(v.string("L'adresse e-mail est invalide"), v.email('Adresse email invalide')),
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
  phone: v.optional(phoneSchema),
  role: v.optional(adminAssignableRoleSchema),
  isActive: v.optional(v.boolean('Le statut actif est invalide')),
})

export type UpdateUserInput = v.InferInput<typeof updateUserSchema>
