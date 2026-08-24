import { object, string, pipe, email, type InferOutput } from 'valibot'

export const forgotPasswordSchema = object({
    email: pipe(string("L'adresse e-mail est requise"), email('Adresse e-mail invalide')),
})

export type ForgotPasswordFormValues = InferOutput<typeof forgotPasswordSchema>
