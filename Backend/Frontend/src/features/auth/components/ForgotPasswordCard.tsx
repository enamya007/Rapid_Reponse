'use client'

import { useForm, Controller } from 'react-hook-form'
import { valibotResolver } from '@hookform/resolvers/valibot'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Button from '@mui/material/Button'
import Alert from '@mui/material/Alert'
import CircularProgress from '@mui/material/CircularProgress'
import Link from 'next/link'
import { ArrowLeft, MailCheck } from 'lucide-react'
import MoonField from './MoonField'
import MoonFieldIcon from './MoonFieldIcon'
import {
    forgotPasswordSchema,
    type ForgotPasswordFormValues,
} from '../schemas/forgotPasswordSchema'
import {
    moonButtonSx,
    moonButtonPendingSx,
    moonFormHeaderSx,
    moonLinkSx,
} from '../constants/moonTheme'
import { authColors } from '../constants/theme'
import { useForgotPassword } from '@/hooks/useAuth'

export default function ForgotPasswordCard() {
    const {
        control,
        handleSubmit,
        getValues,
        formState: { errors },
    } = useForm<ForgotPasswordFormValues>({
        resolver: valibotResolver(forgotPasswordSchema),
        defaultValues: { email: '' },
    })

    const forgotMutation = useForgotPassword()

    const onSubmit = (values: ForgotPasswordFormValues) => {
        forgotMutation.mutate({ email: values.email })
    }

    return (
        <div
            className="flex min-h-screen items-center justify-center px-4 py-6 sm:px-6"
            style={{
                background: authColors.pageBg,
            }}
        >
            <div
                className="w-full overflow-hidden rounded-[20px] bg-white"
                style={{
                    maxWidth: 440,
                    boxShadow: '0 25px 50px -12px rgba(44, 44, 84, 0.25)',
                }}
            >
                {/* Bandeau logo — couleur unie Moon, cohérente avec le panneau promo */}
                <div
                    className="flex items-center gap-2.5 px-8 py-4"
                    style={{
                        background: authColors.moonVioletDark,
                    }}
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

                <div className="auth-form-area px-8 py-7">
                    {forgotMutation.isSuccess ? (
                        /* État succès : confirmation d'envoi, pas de re-soumission possible */
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'center', textAlign: 'center' }}>
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
                                <MailCheck size={30} color={authColors.moonVioletDark} strokeWidth={1.8} />
                            </Box>
                            <Typography sx={moonFormHeaderSx.title}>Vérifiez votre boîte mail</Typography>
                            <Typography sx={{ ...moonFormHeaderSx.subtitle, maxWidth: 320 }}>
                                Si un compte existe pour <strong>{getValues('email')}</strong>, vous
                                recevrez un lien pour réinitialiser votre mot de passe. Pensez à
                                vérifier vos courriers indésirables.
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
                    ) : (
                        <Box
                            component="form"
                            onSubmit={handleSubmit(onSubmit)}
                            noValidate
                            sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
                        >
                            <Box sx={{ mb: 0.25 }}>
                                <Typography variant="h5" sx={moonFormHeaderSx.title}>
                                    Mot de passe oublié ?
                                </Typography>
                                <Typography sx={moonFormHeaderSx.subtitle}>
                                    Entrez votre adresse e-mail et nous vous enverrons un lien pour
                                    réinitialiser votre mot de passe.
                                </Typography>
                            </Box>

                            {forgotMutation.isError && (
                                <Alert severity="error" sx={{ py: 0.25, alignItems: 'center' }}>
                                    Une erreur est survenue, merci de réessayer.
                                </Alert>
                            )}

                            <Controller
                                name="email"
                                control={control}
                                render={({ field }) => (
                                    <MoonField
                                        {...field}
                                        label="Adresse e-mail"
                                        fieldId="forgot-email"
                                        placeholder="name@exemple.com"
                                        type="email"
                                        autoComplete="email"
                                        required
                                        rounded="pill"
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

                            <Button
                                type="submit"
                                disabled={forgotMutation.isPending}
                                fullWidth
                                sx={{
                                    ...moonButtonSx,
                                    ...(forgotMutation.isPending ? moonButtonPendingSx : {}),
                                    mt: 0.5,
                                }}
                            >
                                {forgotMutation.isPending ? (
                                    <CircularProgress size={20} sx={{ color: '#fff' }} />
                                ) : (
                                    'Envoyer le lien'
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
                    )}
                </div>
            </div>
        </div>
    )
}
