'use client'

import { useState } from 'react'
import { Wrench, Plus } from 'lucide-react'
import StatCard from '@/features/dashboard/components/StatCard'
import Modal from '@/features/dashboard/components/Modal'
import RequireRole from '@/components/RequireRole'
import RequiredMark from '@/components/RequiredMark'
import { useTechnicians, useCreateTechnician } from '@/hooks/useTechnicians'
import { useSkills, useCreateSkill } from '@/hooks/useSkills'
import type { Technician } from '@/types/technician'
import { isPhoneEmpty, isValidPhone } from '@/schema/phone.schema'
import {
    isValidEmail,
    isStrongPassword,
    isValidOptionalName,
    isValidUsername,
    requiredFieldMessage,
    NAME_MAX_LENGTH,
    USERNAME_MAX_LENGTH,
    SKILL_NAME_MIN_LENGTH,
    SKILL_NAME_MAX_LENGTH,
} from '@/lib/validators'

const inputClass =
    'w-full rounded-lg border border-moon-abyss/12 px-3.5 py-2.5 text-sm text-moon-abyss placeholder:text-moon-abyss/55 focus:border-moon-violet focus:outline-none'

const labelClass =
    'mb-1.5 block font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-moon-abyss/70'

const errorTextClass = 'mt-1 text-xs text-rose-700'

function displayName(tech: Technician) {
    const full = [tech.firstName, tech.lastName].filter(Boolean).join(' ').trim()
    return full || tech.username
}

function initialsOf(name: string) {
    return name
        .split(' ')
        .filter(Boolean)
        .map((w) => w[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()
}

const emptyCreateForm = {
    username: '',
    email: '',
    password: '',
    firstName: '',
    lastName: '',
    phone: '+228',
    maxConcurrentTickets: '5',
    skillIds: [] as string[],
}

function TechniciansPageContent() {
    const techniciansQuery = useTechnicians({ page: 1, limit: 100 })
    const skillsQuery = useSkills()
    const createTechnician = useCreateTechnician()
    const createSkill = useCreateSkill()

    const technicians = techniciansQuery.data?.data ?? []
    const skills = skillsQuery.data ?? []

    const [skillsOpen, setSkillsOpen] = useState(false)
    const [newSkill, setNewSkill] = useState('')
    const [createOpen, setCreateOpen] = useState(false)
    const [createForm, setCreateForm] = useState(emptyCreateForm)
    const [showCreateErrors, setShowCreateErrors] = useState(false)

    const available = technicians.filter((t) => t.isAvailable).length
    const busy = technicians.filter((t) => !t.isAvailable).length
    const activeTickets = technicians.reduce((sum, t) => sum + t.currentLoad, 0)

    const canSubmitSkill =
        newSkill.trim().length >= SKILL_NAME_MIN_LENGTH &&
        newSkill.trim().length <= SKILL_NAME_MAX_LENGTH

    const addSkill = () => {
        const value = newSkill.trim()
        if (!canSubmitSkill || createSkill.isPending) return

        createSkill.mutate(
            { name: value },
            {
                onSuccess: () => setNewSkill(''),
            },
        )
    }

    const openCreate = () => {
        setCreateForm(emptyCreateForm)
        setShowCreateErrors(false)
        setCreateOpen(true)
    }

    const toggleSkill = (id: string) => {
        setCreateForm((f) => ({
            ...f,
            skillIds: f.skillIds.includes(id)
                ? f.skillIds.filter((s) => s !== id)
                : [...f.skillIds, id],
        }))
    }

    const canSubmitCreate =
        isValidUsername(createForm.username) &&
        isValidEmail(createForm.email) &&
        isStrongPassword(createForm.password) &&
        isValidPhone(createForm.phone) &&
        isValidOptionalName(createForm.firstName) &&
        isValidOptionalName(createForm.lastName)

    const submitCreate = () => {
        if (!canSubmitCreate) {
            setShowCreateErrors(true)
            return
        }

        createTechnician.mutate(
            {
                username: createForm.username.trim(),
                email: createForm.email.trim(),
                password: createForm.password,
                firstName: createForm.firstName.trim() || undefined,
                lastName: createForm.lastName.trim() || undefined,
                phone: createForm.phone.trim(),
                maxConcurrentTickets: Number(createForm.maxConcurrentTickets) || 5,
                skills: createForm.skillIds.map((skillId) => ({ skillId })),
            },
            { onSuccess: () => setCreateOpen(false) },
        )
    }

    return (
        <div className="space-y-5">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold text-moon-abyss">Techniciens</h1>
                    <p className="mt-0.5 text-sm text-moon-abyss/70">
                        {techniciansQuery.data?.meta.total ?? technicians.length}{' '}
                        techniciens
                    </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                    <button
                        type="button"
                        onClick={() => setSkillsOpen(true)}
                        className="flex items-center gap-2 rounded-lg border border-moon-violet/25 bg-white px-4 py-2.5 text-sm font-medium text-moon-violet transition-colors hover:bg-moon-violet hover:text-white"
                    >
                        <Wrench size={15} />
                        Référentiel de compétences
                    </button>
                    <button
                        type="button"
                        onClick={openCreate}
                        className="flex items-center gap-2 rounded-lg bg-moon-violet-dark px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-moon-violet"
                    >
                        <Plus size={16} />
                        Ajouter un technicien
                    </button>
                </div>
            </div>

            {techniciansQuery.isError && (
                <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
                    Impossible de charger les techniciens. Vérifiez que vous êtes
                    connecté en admin et que l’API tourne.
                </p>
            )}

            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <StatCard value={available} label="Disponibles" tone="green" />
                <StatCard value={busy} label="Occupés" tone="violet" />
                <StatCard value={activeTickets} label="Tickets actifs" tone="plum" />
                <StatCard value={skills.length} label="Compétences" tone="rose" />
            </div>

            {techniciansQuery.isLoading && (
                <p className="text-sm text-moon-abyss/70">Chargement…</p>
            )}

            {!techniciansQuery.isLoading && technicians.length === 0 && (
                <p className="rounded-2xl border border-dashed border-moon-abyss/15 bg-white px-5 py-8 text-center text-sm text-moon-abyss/70">
                    Aucun technicien pour l’instant. Ajoutez-en un pour pouvoir affecter
                    des tickets.
                </p>
            )}

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {technicians.map((t) => {
                    const name = displayName(t)
                    const load =
                        t.maxConcurrentTickets > 0
                            ? Math.min(
                                  100,
                                  Math.round((t.currentLoad / t.maxConcurrentTickets) * 100),
                              )
                            : 0

                    return (
                        <div
                            key={t.id}
                            className="rounded-2xl border border-moon-abyss/15 bg-white p-5 shadow-sm"
                        >
                            <div className="flex items-center gap-3">
                                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-moon-lavande/15 text-sm font-bold text-moon-lavande">
                                    {initialsOf(name)}
                                </div>
                                <div className="min-w-0">
                                    <p className="truncate font-bold text-moon-abyss">{name}</p>
                                    <p className="truncate text-xs text-moon-abyss/70">{t.email}</p>
                                    <span
                                        className={`mt-0.5 inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                                            t.isAvailable
                                                ? 'bg-emerald-100 text-emerald-700'
                                                : 'bg-moon-violet/10 text-moon-violet'
                                        }`}
                                    >
                                        {t.isAvailable ? 'Disponible' : 'Occupé'}
                                    </span>
                                </div>
                            </div>

                            <p className="mb-2 mt-4 font-mono text-[10px] uppercase tracking-[0.2em] text-moon-abyss/65">
                                Compétences
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                                {t.skills.length === 0 && (
                                    <span className="text-xs text-moon-abyss/65">Aucune</span>
                                )}
                                {t.skills.map((s) => (
                                    <span
                                        key={s.id}
                                        className="rounded-full bg-moon-rose/50 px-2.5 py-1 text-xs font-medium text-moon-violet-dark"
                                    >
                                        {s.name}
                                    </span>
                                ))}
                            </div>

                            <div className="mt-4 flex items-center gap-3">
                                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-moon-abyss/8">
                                    <div
                                        className="h-full rounded-full bg-moon-violet-dark"
                                        style={{ width: `${load}%` }}
                                    />
                                </div>
                                <span className="font-mono text-xs font-semibold text-moon-lavande">
                                    {t.currentLoad}/{t.maxConcurrentTickets} tickets
                                </span>
                            </div>
                        </div>
                    )
                })}
            </div>

            <Modal
                open={skillsOpen}
                title="Référentiel de compétences"
                onClose={() => setSkillsOpen(false)}
            >
                {skillsQuery.isError && (
                    <p className="mb-3 text-sm text-rose-700">
                        Impossible de charger les compétences.
                    </p>
                )}
                <div className="flex flex-wrap gap-2">
                    {skillsQuery.isLoading && (
                        <span className="text-sm text-moon-abyss/70">Chargement…</span>
                    )}
                    {skills.map((s) => (
                        <span
                            key={s.id}
                            className="rounded-full bg-moon-rose/50 px-3 py-1.5 text-sm font-medium text-moon-violet-dark"
                        >
                            {s.name}
                        </span>
                    ))}
                </div>
                {createSkill.isError && (
                    <p className="mt-3 text-sm text-rose-700">
                        {createSkill.error instanceof Error
                            ? createSkill.error.message
                            : 'Ajout impossible'}
                    </p>
                )}
                <div className="mt-5 flex gap-2.5">
                    <input
                        type="text"
                        value={newSkill}
                        onChange={(e) => setNewSkill(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && addSkill()}
                        placeholder="Nouvelle compétence..."
                        maxLength={SKILL_NAME_MAX_LENGTH}
                        className="flex-1 rounded-lg border border-moon-abyss/12 px-3.5 py-2.5 text-sm text-moon-abyss placeholder:text-moon-abyss/55 focus:border-moon-violet focus:outline-none"
                    />
                    <button
                        type="button"
                        onClick={addSkill}
                        disabled={!canSubmitSkill || createSkill.isPending}
                        className="flex items-center gap-1.5 rounded-lg bg-moon-violet-dark px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-moon-violet disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        <Plus size={15} />
                        {createSkill.isPending ? 'Ajout…' : 'Ajouter'}
                    </button>
                </div>
            </Modal>

            <Modal
                open={createOpen}
                title="Ajouter un technicien"
                onClose={() => setCreateOpen(false)}
                size="lg"
            >
                <div className="space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                            <label htmlFor="tech-username" className={labelClass}>
                                Nom d&apos;utilisateur<RequiredMark />
                            </label>
                            <input
                                id="tech-username"
                                type="text"
                                value={createForm.username}
                                onChange={(e) =>
                                    setCreateForm((f) => ({ ...f, username: e.target.value }))
                                }
                                placeholder="jtech"
                                maxLength={USERNAME_MAX_LENGTH}
                                className={inputClass}
                            />
                            {showCreateErrors && !isValidUsername(createForm.username) && (
                                <p className={errorTextClass}>
                                    {requiredFieldMessage(
                                        createForm.username,
                                        "Le nom d'utilisateur est requis.",
                                        "Le nom d'utilisateur doit contenir entre 3 et 50 caractères.",
                                    )}
                                </p>
                            )}
                        </div>
                        <div>
                            <label htmlFor="tech-email" className={labelClass}>
                                E-mail<RequiredMark />
                            </label>
                            <input
                                id="tech-email"
                                type="email"
                                value={createForm.email}
                                onChange={(e) =>
                                    setCreateForm((f) => ({ ...f, email: e.target.value }))
                                }
                                placeholder="jtech@exemple.com"
                                className={inputClass}
                            />
                            {showCreateErrors && !isValidEmail(createForm.email) && (
                                <p className={errorTextClass}>
                                    {requiredFieldMessage(
                                        createForm.email,
                                        "L'e-mail est requis.",
                                        'Adresse e-mail invalide.',
                                    )}
                                </p>
                            )}
                        </div>
                    </div>
                    <div>
                        <label htmlFor="tech-password" className={labelClass}>
                            Mot de passe<RequiredMark />
                        </label>
                        <input
                            id="tech-password"
                            type="password"
                            value={createForm.password}
                            onChange={(e) =>
                                setCreateForm((f) => ({ ...f, password: e.target.value }))
                            }
                            placeholder="10 caractères, majuscule, minuscule, chiffre"
                            maxLength={72}
                            className={inputClass}
                        />
                        {showCreateErrors && !isStrongPassword(createForm.password) && (
                            <p className={errorTextClass}>
                                {requiredFieldMessage(
                                    createForm.password,
                                    'Le mot de passe est requis.',
                                    '10 caractères minimum, avec majuscule, minuscule et un chiffre.',
                                )}
                            </p>
                        )}
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                            <label htmlFor="tech-firstname" className={labelClass}>
                                Prénom
                            </label>
                            <input
                                id="tech-firstname"
                                type="text"
                                value={createForm.firstName}
                                onChange={(e) =>
                                    setCreateForm((f) => ({ ...f, firstName: e.target.value }))
                                }
                                maxLength={NAME_MAX_LENGTH}
                                className={inputClass}
                            />
                            {showCreateErrors && !isValidOptionalName(createForm.firstName) && (
                                <p className={errorTextClass}>Prénom invalide.</p>
                            )}
                        </div>
                        <div>
                            <label htmlFor="tech-lastname" className={labelClass}>
                                Nom
                            </label>
                            <input
                                id="tech-lastname"
                                type="text"
                                value={createForm.lastName}
                                onChange={(e) =>
                                    setCreateForm((f) => ({ ...f, lastName: e.target.value }))
                                }
                                maxLength={NAME_MAX_LENGTH}
                                className={inputClass}
                            />
                            {showCreateErrors && !isValidOptionalName(createForm.lastName) && (
                                <p className={errorTextClass}>Nom invalide.</p>
                            )}
                        </div>
                    </div>
                    <div>
                        <label htmlFor="tech-phone" className={labelClass}>
                            Téléphone<RequiredMark />
                        </label>
                        <input
                            id="tech-phone"
                            type="tel"
                            value={createForm.phone}
                            onChange={(e) =>
                                setCreateForm((f) => ({ ...f, phone: e.target.value }))
                            }
                            placeholder="+228 90 00 00 00"
                            maxLength={30}
                            className={inputClass}
                        />
                        {showCreateErrors && !isValidPhone(createForm.phone) && (
                            <p className={errorTextClass}>
                                {isPhoneEmpty(createForm.phone)
                                    ? 'Le numéro de téléphone est requis.'
                                    : 'Le numéro doit contenir au moins 8 chiffres.'}
                            </p>
                        )}
                    </div>
                    <div>
                        <label htmlFor="tech-capacity" className={labelClass}>
                            Charge max
                        </label>
                        <input
                            id="tech-capacity"
                            type="number"
                            min={1}
                            max={50}
                            value={createForm.maxConcurrentTickets}
                            onChange={(e) =>
                                setCreateForm((f) => ({
                                    ...f,
                                    maxConcurrentTickets: e.target.value,
                                }))
                            }
                            className={inputClass}
                        />
                    </div>
                    <div>
                        <p className={labelClass}>Compétences</p>
                        <div className="flex flex-wrap gap-1.5">
                            {skills.map((s) => {
                                const selected = createForm.skillIds.includes(s.id)
                                return (
                                    <button
                                        key={s.id}
                                        type="button"
                                        onClick={() => toggleSkill(s.id)}
                                        className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                                            selected
                                                ? 'bg-moon-violet-dark text-white'
                                                : 'bg-moon-rose/50 text-moon-violet-dark hover:bg-moon-rose'
                                        }`}
                                    >
                                        {s.name}
                                    </button>
                                )
                            })}
                        </div>
                    </div>
                    {createTechnician.isError && (
                        <p className="text-sm text-rose-700">
                            {createTechnician.error instanceof Error
                                ? createTechnician.error.message
                                : 'Création impossible'}
                        </p>
                    )}
                    <div className="flex justify-end gap-2.5 pt-2">
                        <button
                            type="button"
                            onClick={() => setCreateOpen(false)}
                            className="rounded-lg border border-moon-abyss/15 px-4 py-2.5 text-sm font-medium text-moon-abyss/70 hover:bg-moon-rose/20"
                        >
                            Annuler
                        </button>
                        <button
                            type="button"
                            onClick={submitCreate}
                            disabled={createTechnician.isPending}
                            className="rounded-lg bg-moon-violet-dark px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-moon-violet disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            {createTechnician.isPending ? 'Création…' : 'Créer'}
                        </button>
                    </div>
                </div>
            </Modal>
        </div>
    )
}

export default function TechniciansPage() {
    return (
        <RequireRole roles={['ADMIN']}>
            <TechniciansPageContent />
        </RequireRole>
    )
}
