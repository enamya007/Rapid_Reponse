import { object, string, pipe, minLength, boolean, type InferOutput } from 'valibot'

export const loginSchema = object({
    email: pipe(
        string("L'identifiant est requis"),
        minLength(1, "L'identifiant est requis"),
    ),
    password: pipe(
        string('Le mot de passe est requis'),
        minLength(1, 'Le mot de passe est requis'),
    ),
    rememberMe: boolean(),
})

export type LoginFormValues = InferOutput<typeof loginSchema>
