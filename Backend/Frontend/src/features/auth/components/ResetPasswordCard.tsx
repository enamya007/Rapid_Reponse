'use client'

import { useState, type ReactNode } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { valibotResolver } from '@hookform/resolvers/valibot'
import { useSearchParams } from 'next/navigation'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Button from '@mui/material/Button'
import Alert from '@mui/material/Alert'
import CircularProgress from '@mui/material/CircularProgress'
import Link from 'next/link'
import { ArrowLeft, CircleCheck, CircleAlert } from 'lucide-react'
import MoonField from './MoonField'
import MoonFieldIcon from './MoonFieldIcon'
import MoonPasswordToggle from './MoonPasswordToggle'
import {
    resetPasswordFormSchema,
    type ResetPasswordFormValues,
} from '../schemas/resetPasswordFormSchema'
import {
    moonButtonSx,
    moonButtonPendingSx,
    moonFormHeaderSx,
    moonLinkSx,
} from '../constants/moonTheme'
import { authColors } from '../constants/theme'
import { useResetPassword } from '@/hooks/useAuth'

function AuthCard({ children }: { children: ReactNode }) {
    return (
        <div
            className="flex min-h-screen items-center justify-center px-4 py-6 sm:px-6"
            style={{ background: authColors.pageBg }}
        >
            <div
                className="w-full overflow-hidden rounded-[20px] bg-white"
                style={{
                    maxWidth: 440,
                    boxShadow: '0 25px 50px -12px rgba(44, 44, 84, 0.25)',
                }}
            >
                <div
                    className="flex items-center gap-2.5 px-8 py-4"
                    style={{ background: authColors.moonVioletDark }}
                >
                    <div
                        className="flex shrink-0 items-center justify-center rounded-xl text-xs font-bold leading-none"
                        style={{
                            width: 36,
                            height: 36,
                            backgroundColor: authColors.badgeBg,
                            color: authColors.badgeText,
                        }}
                    >
                        RR
                    </div>
                    <span className="text-sm font-semibold leading-tight text-white">
                        Rapid Response
                    </span>
                </div>
                <div className="auth-form-area px-8 py-7">{children}</div>
            </div>
        </div>
    )
}

function resetErrorMessage(error: unknown): string {
    const raw = error instanceof Error ? error.message : ''
    if (/invalid or expired token/i.test(raw)) {
        return 'Ce lien est invalide ou a expiré. Demandez un nouveau lien de réinitialisation.'
    }
    return raw || 'Impossible de modifier le mot de passe. Réessayez.'
}

export default function ResetPasswordCard() {
    const searchParams = useSearchParams()
    const token = searchParams.get('token')?.trim() ?? ''
    const [showPassword, setShowPassword] = useState(false)
    const [showConfirm, setShowConfirm] = useState(false)
    const resetMutation = useResetPassword()

    const {
        control,
        handleSubmit,
        formState: { errors },
    } = useForm<ResetPasswordFormValues>({
        resolver: valibotResolver(resetPasswordFormSchema),
        defaultValues: { newPassword: '', confirmPassword: '' },
    })

    const onSubmit = (values: ResetPasswordFormValues) => {
        resetMutation.mutate({ token, newPassword: values.newPassword })
    }

    if (!token) {
        return (
            <AuthCard>
                <Box
                    sx={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 2,
                        alignItems: 'center',
                        textAlign: 'center',
                    }}
                >
                    <Box
                        sx={{
                            width: 64,
                            height: 64,
                            borderRadius: '50%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            bgcolor: authColors.moonRose,
                        }}
                    >
                        <CircleAlert size={30} color={authColors.moonVioletDark} strokeWidth={1.8} />
                    </Box>
                    <Typography sx={moonFormHeaderSx.title}>Lien incomplet</Typography>
                    <Typography sx={{ ...moonFormHeaderSx.subtitle, maxWidth: 320 }}>
                        Ce lien de réinitialisation est incomplet. Ouvrez-le depuis l’e-mail, ou
                        demandez-en un nouveau.
                    </Typography>
                    <Button
                        component={Link}
                        href="/forgot-password"
                        fullWidth
                        sx={{ ...moonButtonSx, mt: 1 }}
                    >
                        Demander un nouveau lien
                    </Button>
                </Box>
            </AuthCard>
        )
    }

    if (resetMutation.isSuccess) {
        return (
            <AuthCard>
                <Box
                    sx={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 2,
                        alignItems: 'center',
                        textAlign: 'center',
                    }}
                >
                    <Box
                        sx={{
                            width: 64,
                            height: 64,
                            borderRadius: '50%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            bgcolor: authColors.moonRose,
                        }}
                    >
                        <CircleCheck size={30} color={authColors.moonVioletDark} strokeWidth={1.8} />
                    </Box>
                    <Typography sx={moonFormHeaderSx.title}>Mot de passe modifié</Typography>
                    <Typography sx={{ ...moonFormHeaderSx.subtitle, maxWidth: 320 }}>
                        Vous pouvez maintenant vous connecter avec votre nouveau mot de passe.
                    </Typography>
                    <Button
                        component={Link}
                        href="/login"
                        fullWidth
                        sx={{ ...moonButtonSx, mt: 1 }}
                    >
                        Retour à la connexion
                    </Button>
                </Box>
            </AuthCard>
        )
    }

    return (
        <AuthCard>
            <Box
                component="form"
                onSubmit={handleSubmit(onSubmit)}
                noValidate
                sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
            >
                <Box sx={{ mb: 0.25 }}>
                    <Typography variant="h5" sx={moonFormHeaderSx.title}>
                        Nouveau mot de passe
                    </Typography>
                    <Typography sx={moonFormHeaderSx.subtitle}>
                        Choisissez un mot de passe d’au moins 10 caractères, avec une minuscule, une
                        majuscule et un chiffre.
                    </Typography>
                </Box>

                {resetMutation.isError && (
                    <Alert severity="error" sx={{ py: 0.25, alignItems: 'center' }}>
                        {resetErrorMessage(resetMutation.error)}
                    </Alert>
                )}

                <Controller
                    name="newPassword"
                    control={control}
                    render={({ field }) => (
                        <MoonField
                            {...field}
                            label="Nouveau mot de passe"
                            fieldId="reset-password"
                            placeholder="Nouveau mot de passe"
                            type={showPassword ? 'text' : 'password'}
                            autoComplete="new-password"
                            required
                            rounded="pill"
                            error={!!errors.newPassword}
                            helperText={errors.newPassword?.message}
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
                            fieldId="reset-confirm-password"
                            placeholder="Confirmer le mot de passe"
                            type={showConfirm ? 'text' : 'password'}
                            autoComplete="new-password"
                            required
                            rounded="pill"
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
                    disabled={resetMutation.isPending}
                    fullWidth
                    sx={{
                        ...moonButtonSx,
                        ...(resetMutation.isPending ? moonButtonPendingSx : {}),
                        mt: 0.5,
                    }}
                >
                    {resetMutation.isPending ? (
                        <CircularProgress size={20} sx={{ color: '#fff' }} />
                    ) : (
                        'Enregistrer le mot de passe'
                    )}
                </Button>

                <Typography
                    component={Link}
                    href="/login"
                    sx={{
                        ...moonLinkSx,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 0.75,
                        justifyContent: 'center',
                        mt: 0.5,
                    }}
                >
                    <ArrowLeft size={16} strokeWidth={2} />
                    Retour à la connexion
                </Typography>
            </Box>
        </AuthCard>
    )
}
