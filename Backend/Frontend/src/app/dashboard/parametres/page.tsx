'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useMe, useUpdateMe } from '@/hooks/useAuth'
import { logoutCurrentSession } from '@/lib/logout'
import { isValidPhone } from '@/schema/phone.schema'
import RequiredMark from '@/components/RequiredMark'
import {
    isValidEmail,
    isValidOptionalName,
    isValidUsername,
    NAME_MAX_LENGTH,
    USERNAME_MAX_LENGTH,
} from '@/lib/validators'

const roleLabels = {
    ADMIN: 'Administrateur',
    TECHNICIAN: 'Technicien',
    CLIENT: 'Client',
} as const

const inputClass =
    'w-full rounded-lg border border-moon-abyss/12 px-3.5 py-2.5 text-sm text-moon-abyss placeholder:text-moon-abyss/55 focus:border-moon-violet focus:outline-none'

const labelClass =
    'mb-1.5 block font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-moon-abyss/70'

export default function SettingsPage() {
    const meQuery = useMe()
    const me = meQuery.data
    const updateMe = useUpdateMe()

    const [form, setForm] = useState({
        username: '',
        email: '',
        firstName: '',
        lastName: '',
        phone: '',
    })
    const [loadedForId, setLoadedForId] = useState<string | null>(null)

    if (me && loadedForId !== me.id) {
        setLoadedForId(me.id)
        setForm({
            username: me.username,
            email: me.email,
            firstName: me.firstName ?? '',
            lastName: me.lastName ?? '',
            phone: me.phone ?? '+228',
        })
    }

    const canSave =
        isValidUsername(form.username) &&
        isValidEmail(form.email) &&
        isValidPhone(form.phone) &&
        isValidOptionalName(form.firstName) &&
        isValidOptionalName(form.lastName)

    const save = () => {
        if (!me || !canSave) return
        updateMe.mutate({
            username: form.username.trim(),
            email: form.email.trim(),
            firstName: form.firstName.trim() || undefined,
            lastName: form.lastName.trim() || undefined,
            phone: form.phone.trim(),
        })
    }

    return (
        <div className="space-y-5">
            <div>
                <h1 className="text-2xl font-bold text-moon-abyss">Paramètres</h1>
                <p className="mt-0.5 text-sm text-moon-abyss/70">Votre compte</p>
            </div>

            <div className="rounded-2xl border border-moon-abyss/15 bg-white p-5 shadow-sm">
                <h2 className="font-bold text-moon-violet-dark">Profil</h2>
                {meQuery.isLoading && (
                    <p className="mt-4 text-sm text-moon-abyss/70">Chargement…</p>
                )}
                {meQuery.isError && (
                    <p className="mt-4 text-sm text-rose-700">Impossible de charger le profil.</p>
                )}
                {me && (
                    <div className="mt-4 space-y-4">
                        <p className="text-xs text-moon-abyss/70">
                            Rôle : {roleLabels[me.role]} — vous ne pouvez pas changer votre propre
                            rôle ici.
                        </p>
                        <div className="grid gap-4 sm:grid-cols-2">
                            <div>
                                <label htmlFor="me-username" className={labelClass}>
                                    Identifiant<RequiredMark />
                                </label>
                                <input
                                    id="me-username"
                                    value={form.username}
                                    onChange={(e) =>
                                        setForm((f) => ({ ...f, username: e.target.value }))
                                    }
                                    maxLength={USERNAME_MAX_LENGTH}
                                    className={inputClass}
                                />
                            </div>
                            <div>
                                <label htmlFor="me-email" className={labelClass}>
                                    Email<RequiredMark />
                                </label>
                                <input
                                    id="me-email"
                                    type="email"
                                    value={form.email}
                                    onChange={(e) =>
                                        setForm((f) => ({ ...f, email: e.target.value }))
                                    }
                                    className={inputClass}
                                />
                            </div>
                            <div>
                                <label htmlFor="me-firstname" className={labelClass}>
                                    Prénom
                                </label>
                                <input
                                    id="me-firstname"
                                    value={form.firstName}
                                    onChange={(e) =>
                                        setForm((f) => ({ ...f, firstName: e.target.value }))
                                    }
                                    maxLength={NAME_MAX_LENGTH}
                                    className={inputClass}
                                />
                            </div>
                            <div>
                                <label htmlFor="me-lastname" className={labelClass}>
                                    Nom
                                </label>
                                <input
                                    id="me-lastname"
                                    value={form.lastName}
                                    onChange={(e) =>
                                        setForm((f) => ({ ...f, lastName: e.target.value }))
                                    }
                                    maxLength={NAME_MAX_LENGTH}
                                    className={inputClass}
                                />
                            </div>
                            <div className="sm:col-span-2">
                                <label htmlFor="me-phone" className={labelClass}>
                                    Téléphone<RequiredMark />
                                </label>
                                <input
                                    id="me-phone"
                                    type="tel"
                                    value={form.phone}
                                    onChange={(e) =>
                                        setForm((f) => ({ ...f, phone: e.target.value }))
                                    }
                                    maxLength={30}
                                    className={inputClass}
                                />
                            </div>
                        </div>
                        {updateMe.isError && (
                            <p className="text-sm text-rose-700">
                                {updateMe.error instanceof Error
                                    ? updateMe.error.message
                                    : 'Enregistrement impossible'}
                            </p>
                        )}
                        {updateMe.isSuccess && (
                            <p className="text-sm text-emerald-700">Profil mis à jour.</p>
                        )}
                        <div className="flex justify-end">
                            <button
                                type="button"
                                onClick={save}
                                disabled={!canSave || updateMe.isPending}
                                className="rounded-lg bg-moon-violet-dark px-4 py-2.5 text-sm font-medium text-white hover:bg-moon-violet disabled:opacity-40"
                            >
                                {updateMe.isPending ? 'Enregistrement…' : 'Enregistrer'}
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {me && (
                <p className="text-sm text-moon-abyss/70">
                    <Link href="/forgot-password" className="font-medium text-moon-violet underline">
                        Cliquez ici
                    </Link>
                    , pour changer de mot de passe.
                </p>
            )}

            <button
                type="button"
                onClick={() => void logoutCurrentSession()}
                className="rounded-lg border border-moon-abyss/15 px-4 py-2.5 text-sm font-medium text-moon-abyss/80 hover:bg-moon-rose/20"
            >
                Se déconnecter
            </button>
        </div>
    )
}
