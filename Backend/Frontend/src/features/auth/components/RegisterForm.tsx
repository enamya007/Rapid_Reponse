'use client'

import { useState } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { valibotResolver } from '@hookform/resolvers/valibot'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Button from '@mui/material/Button'
import Alert from '@mui/material/Alert'
import CircularProgress from '@mui/material/CircularProgress'
import MoonField from './MoonField'
import MoonFieldIcon from './MoonFieldIcon'
import MoonPasswordToggle from './MoonPasswordToggle'
import { registerSchema, type RegisterFormValues } from '../schemas/registerSchema'
import { moonButtonSx, moonButtonPendingSx, moonFormHeaderSx } from '../constants/moonTheme'
import { useRegister } from '@/hooks/useAuth'

export default function RegisterForm() {
    const [showPassword, setShowPassword] = useState(false)
    const [showConfirm, setShowConfirm] = useState(false)

    const {
        control,
        handleSubmit,
        formState: { errors },
    } = useForm<RegisterFormValues>({
        resolver: valibotResolver(registerSchema),
        defaultValues: { fullName: '', email: '', phone: '+228', password: '', confirmPassword: '' },
    })

    const registerMutation = useRegister()
    const router = useRouter()

    const onSubmit = (values: RegisterFormValues) => {
        const parts = values.fullName.trim().split(/\s+/)
        const firstName = parts[0]
        const lastName = parts.slice(1).join(' ') || undefined
        const username = values.email.split('@')[0] ?? values.email

        registerMutation.mutate(
            {
                username,
                email: values.email,
                password: values.password,
                firstName,
                lastName,
                phone: values.phone.trim(),
            },
            {
                onSuccess: async () => {
                    const result = await signIn('credentials', {
                        identifier: values.email,
                        password: values.password,
                        redirect: false,
                    })
                    if (result?.ok) {
                        router.push('/dashboard')
                        router.refresh()
                    }
                },
            },
        )
    }

    return (
        <Box
            component="form"
            onSubmit={handleSubmit(onSubmit)}
            noValidate
            sx={{ display: 'flex', flexDirection: 'column', gap: 1.35 }}
        >
            <Box sx={{ mb: 0.25 }}>
                <Typography variant="h5" sx={moonFormHeaderSx.title}>
                    Créer un compte
                </Typography>
                <Typography sx={moonFormHeaderSx.subtitle}>Inscrivez-vous pour commencer</Typography>
            </Box>

            {registerMutation.isError && (
                <Alert severity="error" sx={{ py: 0.25, alignItems: 'center' }}>
                    {registerMutation.error instanceof Error
                        ? registerMutation.error.message
                        : 'Impossible de créer le compte. Réessayez.'}
                </Alert>
            )}

            <Controller
                name="fullName"
                control={control}
                render={({ field }) => (
                    <MoonField
                        {...field}
                        label="Nom et Prénom(s)"
                        fieldId="register-fullname"
                        placeholder="KOLA Balakiyém"
                        autoComplete="name"
                        required
                        error={!!errors.fullName}
                        helperText={errors.fullName?.message}
                        slotProps={{
                            htmlInput: { maxLength: 80 },
                            input: {
                                startAdornment: <MoonFieldIcon type="user" />,
                            },
                        }}
                    />
                )}
            />

            <Controller
                name="email"
                control={control}
                render={({ field }) => (
                    <MoonField
                        {...field}
                        label="Adresse e-mail"
                        fieldId="register-email"
                        placeholder="name@exemple.com"
                        type="email"
                        autoComplete="email"
                        required
                        error={!!errors.email}
                        helperText={errors.email?.message}
                        slotProps={{
                            input: {
                                startAdornment: <MoonFieldIcon type="mail" />,
                            },
                        }}
                    />
                )}
            />

            <Controller
                name="phone"
                control={control}
                render={({ field }) => (
                    <MoonField
                        {...field}
                        label="Numéro de téléphone"
                        fieldId="register-phone"
                        placeholder="+228 90 00 00 00"
                        type="tel"
                        autoComplete="tel"
                        required
                        error={!!errors.phone}
                        helperText={errors.phone?.message}
                        slotProps={{
                            htmlInput: { maxLength: 30 },
                            input: {
                                startAdornment: <MoonFieldIcon type="phone" />,
                            },
                        }}
                    />
                )}
            />

            <Controller
                name="password"
                control={control}
                render={({ field }) => (
                    <MoonField
                        {...field}
                        label="Mot de passe"
                        fieldId="register-password"
                        placeholder="Mot de passe"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        required
                        error={!!errors.password}
                        helperText={errors.password?.message}
                        slotProps={{
                            htmlInput: { maxLength: 72 },
                            input: {
                                startAdornment: <MoonFieldIcon type="lock" />,
                                endAdornment: (
                                    <MoonPasswordToggle
                                        visible={showPassword}
                                        onToggle={() => setShowPassword((p) => !p)}
                                    />
                                ),
                            },
                        }}
                    />
                )}
            />

            <Controller
                name="confirmPassword"
                control={control}
                render={({ field }) => (
                    <MoonField
                        {...field}
                        label="Confirmer le mot de passe"
                        fieldId="register-confirm-password"
                        placeholder="Confirmer le mot de passe"
                        type={showConfirm ? 'text' : 'password'}
                        autoComplete="new-password"
                        required
                        error={!!errors.confirmPassword}
                        helperText={errors.confirmPassword?.message}
                        slotProps={{
                            htmlInput: { maxLength: 72 },
                            input: {
                                startAdornment: <MoonFieldIcon type="key" />,
                                endAdornment: (
                                    <MoonPasswordToggle
                                        visible={showConfirm}
                                        onToggle={() => setShowConfirm((p) => !p)}
                                    />
                                ),
                            },
                        }}
                    />
                )}
            />

            <Button
                type="submit"
                disabled={registerMutation.isPending}
                fullWidth
                sx={{
                    ...moonButtonSx,
                    ...(registerMutation.isPending ? moonButtonPendingSx : {}),
                    mt: 0.5,
                }}
            >
                {registerMutation.isPending ? (
                    <CircularProgress size={20} sx={{ color: '#fff' }} />
                ) : (
                    "S'inscrire"
                )}
            </Button>
        </Box>
    )
}
