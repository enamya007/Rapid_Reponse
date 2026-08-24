import * as v from 'valibot'
import { phoneSchema } from '@/schema/phone.schema'

export const registerSchema = v.object({
  username: v.pipe(
    v.string("Le nom d'utilisateur est requis"),
    v.nonEmpty("Le nom d'utilisateur est requis"),
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
  firstName: v.optional(v.string('Le prénom est invalide')),
  lastName: v.optional(v.string('Le nom est invalide')),
  phone: phoneSchema,
})

export type RegisterInput = v.InferInput<typeof registerSchema>

export const loginSchema = v.object({
  identifier: v.pipe(
    v.string("L'identifiant est requis"),
    v.nonEmpty("L'identifiant est requis"),
  ),
  password: v.pipe(
    v.string('Le mot de passe est requis'),
    v.nonEmpty('Le mot de passe est requis'),
  ),
})

export type LoginInput = v.InferInput<typeof loginSchema>


export const refreshTokenSchema = v.object({
  refreshToken: v.pipe(
    v.string('Le refresh token est requis'),
    v.nonEmpty('Le refresh token est requis'),
  ),
})

export type RefreshTokenInput = v.InferInput<typeof refreshTokenSchema>

export const forgotPasswordSchema = v.object({
  email: v.pipe(
    v.string("L'adresse e-mail est requise"),
    v.nonEmpty("L'adresse e-mail est requise"),
    v.email('Adresse email invalide'),
  ),
})

export type ForgotPasswordInput = v.InferInput<typeof forgotPasswordSchema>

const strongPassword = v.pipe(
  v.string('Le nouveau mot de passe est requis'),
  v.nonEmpty('Le nouveau mot de passe est requis'),
  v.minLength(10, 'Le mot de passe doit contenir au moins 10 caractères'),
  v.maxLength(72, 'Le mot de passe ne doit pas dépasser 72 caractères'),
  v.regex(
    /(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
    'Le mot de passe doit contenir une minuscule, une majuscule et un chiffre',
  ),
)

export const resetPasswordSchema = v.object({
  token: v.pipe(
    v.string('Le jeton est requis'),
    v.nonEmpty('Le jeton est requis'),
  ),
  newPassword: strongPassword,
})

export type ResetPasswordInput = v.InferInput<typeof resetPasswordSchema>

/** Alias : logout nous renvoie le même body que refresh (RefreshTokenDto). */
export const logoutSchema = refreshTokenSchema
export type LogoutInput = RefreshTokenInput

export const updateMeSchema = v.object({
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
})

export type UpdateMeInput = v.InferInput<typeof updateMeSchema>
