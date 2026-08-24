import * as v from 'valibot'

const ticketPrioritySchema = v.picklist(
  ['LOW', 'NORMAL', 'HIGH', 'CRITICAL'] as const,
  'Valeur invalide pour la priorité',
)

const commentVisibilitySchema = v.picklist(
  ['PUBLIC', 'INTERNAL'] as const,
  'Valeur invalide pour la visibilité',
)

export const createTicketSchema = v.object({
  title: v.pipe(
    v.string('Le titre est requis'),
    v.nonEmpty('Le titre est requis'),
    v.minLength(3, 'Le titre doit contenir au moins 3 caractères'),
    v.maxLength(150, 'Le titre ne doit pas dépasser 150 caractères'),
  ),
  description: v.pipe(
    v.string('La description est requise'),
    v.nonEmpty('La description est requise'),
    v.minLength(1, 'La description doit contenir au moins 1 caractère'),
    v.maxLength(5000, 'La description ne doit pas dépasser 5000 caractères'),
  ),
  priority: v.optional(ticketPrioritySchema),
  categoryId: v.pipe(
    v.string('La catégorie est requise'),
    v.nonEmpty('La catégorie est requise'),
    v.uuid('Identifiant invalide'),
  ),
  siteLabel: v.pipe(
    v.string('Le site est requis'),
    v.nonEmpty("Indiquez le lieu d'intervention"),
    v.minLength(2, 'Le site doit contenir au moins 2 caractères'),
    v.maxLength(150, 'Le libellé du site ne doit pas dépasser 150 caractères'),
  ),
  siteAddress: v.optional(
    v.pipe(
      v.string("L'adresse du site est invalide"),
      v.maxLength(2000, "L'adresse du site ne doit pas dépasser 2000 caractères"),
    ),
  ),
})

export type CreateTicketInput = v.InferInput<typeof createTicketSchema>

export const updateTicketSchema = v.object({
  title: v.optional(
    v.pipe(
      v.string('Le titre est invalide'),
      v.minLength(3, 'Le titre doit contenir au moins 3 caractères'),
      v.maxLength(150, 'Le titre ne doit pas dépasser 150 caractères'),
    ),
  ),
  description: v.optional(
    v.pipe(
      v.string('La description est invalide'),
      v.minLength(1, 'La description doit contenir au moins 1 caractère'),
      v.maxLength(5000, 'La description ne doit pas dépasser 5000 caractères'),
    ),
  ),
  priority: v.optional(ticketPrioritySchema),
  categoryId: v.optional(
    v.pipe(v.string('La catégorie est invalide'), v.uuid('Identifiant invalide')),
  ),
  siteLabel: v.optional(
    v.pipe(
      v.string('Le libellé du site est invalide'),
      v.maxLength(150, 'Le libellé du site ne doit pas dépasser 150 caractères'),
    ),
  ),
  siteAddress: v.optional(
    v.pipe(
      v.string("L'adresse du site est invalide"),
      v.maxLength(2000, "L'adresse du site ne doit pas dépasser 2000 caractères"),
    ),
  ),
})

export type UpdateTicketInput = v.InferInput<typeof updateTicketSchema>

export const resolveTicketSchema = v.object({
  resolutionNote: v.pipe(
    v.string('La note de résolution est requise'),
    v.nonEmpty('La note de résolution est requise'),
    v.minLength(1, 'La note de résolution doit contenir au moins 1 caractère'),
    v.maxLength(2000, 'La note de résolution ne doit pas dépasser 2000 caractères'),
  ),
})

export type ResolveTicketInput = v.InferInput<typeof resolveTicketSchema>

export const reasonSchema = v.object({
  reason: v.optional(
    v.pipe(
      v.string('Le motif est invalide'),
      v.minLength(1, 'Le motif doit contenir au moins 1 caractère'),
      v.maxLength(1000, 'Le motif ne doit pas dépasser 1000 caractères'),
    ),
  ),
})

export type ReasonInput = v.InferInput<typeof reasonSchema>

export const assignTicketSchema = v.object({
  technicianId: v.pipe(
    v.string('Le technicien est requis'),
    v.nonEmpty('Le technicien est requis'),
    v.uuid('Identifiant invalide'),
  ),
  reason: v.optional(
    v.pipe(
      v.string('Le motif est invalide'),
      v.minLength(1, 'Le motif doit contenir au moins 1 caractère'),
      v.maxLength(1000, 'Le motif ne doit pas dépasser 1000 caractères'),
    ),
  ),
  isAutoSuggested: v.optional(v.boolean('La suggestion automatique est invalide')),
})

export type AssignTicketInput = v.InferInput<typeof assignTicketSchema>

export const createCommentSchema = v.object({
  body: v.pipe(
    v.string('Le contenu est requis'),
    v.nonEmpty('Le contenu est requis'),
    v.minLength(1, 'Le contenu doit contenir au moins 1 caractère'),
    v.maxLength(5000, 'Le contenu ne doit pas dépasser 5000 caractères'),
  ),
  visibility: v.optional(commentVisibilitySchema),
})

export type CreateCommentInput = v.InferInput<typeof createCommentSchema>
