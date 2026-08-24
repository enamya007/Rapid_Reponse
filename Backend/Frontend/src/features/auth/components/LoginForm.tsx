'use client'

import { useState } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { valibotResolver } from '@hookform/resolvers/valibot'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Button from '@mui/material/Button'
import FormControlLabel from '@mui/material/FormControlLabel'
import Checkbox from '@mui/material/Checkbox'
import Alert from '@mui/material/Alert'
import CircularProgress from '@mui/material/CircularProgress'
import Link from 'next/link'
import MoonField from './MoonField'
import MoonFieldIcon from './MoonFieldIcon'
import MoonPasswordToggle from './MoonPasswordToggle'
import { loginSchema, type LoginFormValues } from '../schemas/loginSchema'
import {
    moonButtonSx,
    moonButtonPendingSx,
    moonCheckboxLabelSx,
    moonCheckboxSx,
    moonFormHeaderSx,
    moonLinkSx,
} from '../constants/moonTheme'

export default function LoginForm() {
    const [showPassword, setShowPassword] = useState(false)
    const [isPending, setIsPending] = useState(false)
    const [isError, setIsError] = useState(false)
    const router = useRouter()

    const {
        control,
        handleSubmit,
        formState: { errors },
    } = useForm<LoginFormValues>({
        resolver: valibotResolver(loginSchema),
        defaultValues: { email: '', password: '', rememberMe: false },
    })

    const onSubmit = async (values: LoginFormValues) => {
        setIsError(false)
        setIsPending(true)

        const result = await signIn('credentials', {
            identifier: values.email,
            password: values.password,
            redirect: false,
        })

        setIsPending(false)

        if (!result?.ok) {
            setIsError(true)
            return
        }

        router.push('/dashboard')
        router.refresh()
    }

    return (
        <Box
            component="form"
            onSubmit={handleSubmit(onSubmit)}
            noValidate
            sx={{ display: 'flex', flexDirection: 'column', gap: 1.75 }}
        >
            <Box sx={{ mb: 0.25 }}>
                <Typography variant="h5" sx={moonFormHeaderSx.title}>
                    Connexion
                </Typography>
                <Typography sx={moonFormHeaderSx.subtitle}>Connectez-vous à votre espace</Typography>
            </Box>

            {isError && (
                <Alert severity="error" sx={{ py: 0.25, alignItems: 'center' }}>
                    Identifiant ou mot de passe incorrect.
                </Alert>
            )}

            <Controller
                name="email"
                control={control}
                render={({ field }) => (
                    <MoonField
                        {...field}
                        label="E-mail ou nom d'utilisateur"
                        fieldId="login-email"
                        placeholder="name@exemple.com"
                        type="text"
                        autoComplete="username"
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

            <Controller
                name="password"
                control={control}
                render={({ field }) => (
                    <MoonField
                        {...field}
                        label="Mot de passe"
                        fieldId="login-password"
                        placeholder="Mot de passe"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="current-password"
                        required
                        rounded="pill"
                        error={!!errors.password}
                        helperText={errors.password?.message}
                        slotProps={{
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

            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 0.5,
                    mt: 0,
                }}
            >
                <Controller
                    name="rememberMe"
                    control={control}
                    render={({ field: { value, onChange, ...field } }) => (
                        <FormControlLabel
                            control={
                                <Checkbox {...field} checked={!!value} onChange={onChange} sx={moonCheckboxSx} />
                            }
                            label="Se souvenir de moi"
                            sx={moonCheckboxLabelSx}
                        />
                    )}
                />
                <Typography component={Link} href="/forgot-password" sx={moonLinkSx}>
                    Mot de passe oublié ?
                </Typography>
            </Box>

            <Button
                type="submit"
                disabled={isPending}
                fullWidth
                sx={{
                    ...moonButtonSx,
                    ...(isPending ? moonButtonPendingSx : {}),
                    mt: 0.5,
                }}
            >
                {isPending ? (
                    <CircularProgress size={20} sx={{ color: '#fff' }} />
                ) : (
                    'Se connecter'
                )}
            </Button>
        </Box>
    )
}
