import { object, string, pipe, email, minLength, maxLength, regex, forward, check, type InferOutput } from 'valibot'

const NAME_PATTERN = /^[A-Za-zÀ-ÖØ-öø-ÿ' -]+$/

export const registerSchema = pipe(
    object({
        fullName: pipe(
            string('Le nom est requis'),
            minLength(2, 'Trop court'),
            maxLength(80, 'Le nom ne doit pas dépasser 80 caractères'),
            regex(NAME_PATTERN, 'Le nom ne doit contenir que des lettres')
        ),
        email: pipe(
            string("L'email est requis"),
            email('Format d\'email invalide')
        ),
        phone: pipe(
            string('Le numéro de téléphone est requis'),
            minLength(8, 'Le numéro doit contenir au moins 8 caractères'),
            maxLength(30, 'Le numéro ne doit pas dépasser 30 caractères')
        ),
        password: pipe(
            string('Le mot de passe est requis'),
            minLength(10, 'Entrez un minimum de 10 caractères'),
            maxLength(72, 'Le mot de passe ne doit pas dépasser 72 caractères')
        ),
        confirmPassword: pipe(
            string('Veuillez confirmer le mot de passe'),
            minLength(10, 'Entrez un minimum de 10 caractères'),
            maxLength(72, 'Le mot de passe ne doit pas dépasser 72 caractères')
        )
    }),
    forward(
        check((input) => input.password === input.confirmPassword, 'Les mots de passe ne correspondent pas'),
        ['confirmPassword']
    )
)

export type RegisterFormValues = InferOutput<typeof registerSchema>