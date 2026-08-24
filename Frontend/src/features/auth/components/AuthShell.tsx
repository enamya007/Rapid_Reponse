'use client'

import { useState } from 'react'
import { authColors, authLayout } from '../constants/theme'
import LoginForm from './LoginForm'
import RegisterForm from './RegisterForm'

type Mode = 'login' | 'register'

const slideClass =
    'absolute top-0 h-full transition-[left] duration-[600ms] ease-in-out will-change-[left]'

export default function AuthShell({ initialMode = 'login' }: { initialMode?: Mode }) {
    const [mode, setMode] = useState<Mode>(initialMode)
    const isRegister = mode === 'register'

    const {
        cardWidth,
        cardHeight,
        panelPaddingX,
        panelPaddingY,
        logoBlockHeight,
        formPanelWidth,
        promoPanelWidth,
        formContentMaxWidth,
        logoBadgeSize,
    } = authLayout

    return (
        <div
            className="flex min-h-screen items-center justify-center px-4 py-6 sm:px-6"
            style={{ backgroundColor: authColors.pageBg }}
        >
            <div
                className="relative overflow-hidden rounded-[20px] shadow-2xl"
                style={{
                    width: cardWidth,
                    maxWidth: '100%',
                    height: cardHeight,
                    boxShadow: '0 25px 50px -12px rgba(44, 44, 84, 0.35)',
                }}
            >
                {/* Panneau formulaire */}
                <div
                    className={`${slideClass} z-20 bg-white`}
                    style={{
                        width: formPanelWidth,
                        left: isRegister ? '0%' : promoPanelWidth,
                    }}
                >
                    <div
                        className="auth-form-area flex h-full flex-col justify-center overflow-hidden"
                        style={{
                            paddingTop: panelPaddingY,
                            paddingBottom: panelPaddingY,
                            paddingLeft: panelPaddingX,
                            paddingRight: panelPaddingX,
                        }}
                    >
                        <div
                            className="relative mx-auto w-full"
                            style={{ maxWidth: formContentMaxWidth }}
                        >
                            <div
                                aria-hidden={isRegister}
                                className={
                                    isRegister
                                        ? 'pointer-events-none invisible absolute inset-0'
                                        : 'relative'
                                }
                            >
                                <LoginForm />
                            </div>
                            <div
                                aria-hidden={!isRegister}
                                className={
                                    !isRegister
                                        ? 'pointer-events-none invisible absolute inset-0'
                                        : 'relative'
                                }
                            >
                                <RegisterForm />
                            </div>
                        </div>
                    </div>
                </div>

                {/* Panneau promo violet */}
                <div
                    className={`auth-promo-panel ${slideClass} z-10 text-white`}
                    style={{
                        width: promoPanelWidth,
                        left: isRegister ? formPanelWidth : '0%',
                        background: authColors.moonVioletDark,
                    }}
                >
                    <div className="auth-promo-panel__halo" aria-hidden />

                    <div
                        className="auth-promo-panel__content flex w-full items-center gap-2.5"
                        style={{
                            paddingTop: panelPaddingY,
                            paddingLeft: panelPaddingX,
                            paddingRight: panelPaddingX,
                            minHeight: logoBlockHeight,
                        }}
                    >
                        <div
                            className="flex shrink-0 items-center justify-center rounded-xl text-xs font-bold leading-none"
                            style={{
                                width: logoBadgeSize,
                                height: logoBadgeSize,
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

                    <div
                        className="auth-promo-panel__content relative flex flex-col items-center justify-center text-center"
                        style={{
                            minHeight: `calc(100% - ${logoBlockHeight}px)`,
                            paddingLeft: panelPaddingX,
                            paddingRight: panelPaddingX,
                            paddingBottom: panelPaddingY,
                        }}
                    >
                        <div
                            aria-hidden={isRegister}
                            className={
                                isRegister
                                    ? 'pointer-events-none invisible absolute inset-0 flex flex-col items-center justify-center px-2'
                                    : 'flex flex-col items-center justify-center'
                            }
                        >
                            <h2 className="mb-2 max-w-[260px] text-[1.15rem] font-bold leading-snug">
                                Bienvenue sur Rapid Response
                            </h2>
                            <p
                                className="mb-6 max-w-[260px] text-sm leading-relaxed"
                                style={{ color: authColors.moonRose, opacity: 0.92 }}
                            >
                                Gérez efficacement vos interventions techniques et suivez chaque demande en temps réel.
                            </p>
                            <button
                                type="button"
                                onClick={() => setMode('register')}
                                className="rounded-full border px-6 py-2 text-sm font-medium transition-colors hover:bg-moon-rose hover:text-moon-violet-dark"
                                style={{
                                    borderColor: authColors.moonRose,
                                    color: authColors.moonRose,
                                }}
                            >
                                Créer un compte
                            </button>
                        </div>

                        <div
                            aria-hidden={!isRegister}
                            className={
                                !isRegister
                                    ? 'pointer-events-none invisible absolute inset-0 flex flex-col items-center justify-center px-2'
                                    : 'flex flex-col items-center justify-center'
                            }
                        >
                            <h2 className="mb-2 text-[1.15rem] font-bold leading-snug">Déjà membre ?</h2>
                            <p
                                className="mb-6 max-w-[260px] text-sm leading-relaxed"
                                style={{ color: authColors.moonRose, opacity: 0.92 }}
                            >
                                Connectez-vous pour accéder à votre espace et gérer vos interventions.
                            </p>
                            <button
                                type="button"
                                onClick={() => setMode('login')}
                                className="rounded-full border px-6 py-2 text-sm font-medium transition-colors hover:bg-moon-rose hover:text-moon-violet-dark"
                                style={{
                                    borderColor: authColors.moonRose,
                                    color: authColors.moonRose,
                                }}
                            >
                                Se connecter
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
