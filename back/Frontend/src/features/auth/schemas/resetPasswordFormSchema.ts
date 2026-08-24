import {
    object,
    string,
    pipe,
    minLength,
    maxLength,
    regex,
    forward,
    check,
    type InferOutput,
} from 'valibot'

const passwordField = pipe(
    string('Le mot de passe est requis'),
    minLength(10, 'Entrez un minimum de 10 caractères'),
    maxLength(72, 'Le mot de passe ne doit pas dépasser 72 caractères'),
    regex(
        /(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
        'Une minuscule, une majuscule et un chiffre sont requis',
    ),
)

export const resetPasswordFormSchema = pipe(
    object({
        newPassword: passwordField,
        confirmPassword: pipe(
            string('Veuillez confirmer le mot de passe'),
            minLength(10, 'Entrez un minimum de 10 caractères'),
            maxLength(72, 'Le mot de passe ne doit pas dépasser 72 caractères'),
        ),
    }),
    forward(
        check(
            (input) => input.newPassword === input.confirmPassword,
            'Les mots de passe ne correspondent pas',
        ),
        ['confirmPassword'],
    ),
)

export type ResetPasswordFormValues = InferOutput<typeof resetPasswordFormSchema>
