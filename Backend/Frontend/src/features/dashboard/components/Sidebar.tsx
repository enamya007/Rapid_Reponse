'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSession } from 'next-auth/react'
import {
    Ticket,
    LayoutDashboard,
    Wrench,
    Users,
    Activity,
    Settings,
    type LucideIcon,
} from 'lucide-react'
import { ALL_NAV_HREFS, navKeysForRole, type NavItemKey } from '@/lib/roles'
import { logoutCurrentSession } from '@/lib/logout'
import type { UserRole } from '@/types/auth'

const navMeta: Record<NavItemKey, { label: string; icon: LucideIcon }> = {
    tickets: { label: 'Tickets', icon: Ticket },
    dashboard: { label: 'Tableau de bord', icon: LayoutDashboard },
    techniciens: { label: 'Techniciens', icon: Wrench },
    utilisateurs: { label: 'Utilisateurs', icon: Users },
    statistiques: { label: 'Statistiques', icon: Activity },
    parametres: { label: 'Paramètres', icon: Settings },
}

const roleLabels: Record<UserRole, string> = {
    ADMIN: 'Administrateur',
    TECHNICIAN: 'Technicien',
    CLIENT: 'Client',
}

export default function Sidebar() {
    const pathname = usePathname()
    const { data } = useSession()
    const name = data?.user?.name ?? data?.user?.email ?? 'Utilisateur'
    const roleLabel = data?.user?.role ? roleLabels[data.user.role] : ''
    const initials = name
        .split(' ')
        .map((w) => w[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()

    const items = navKeysForRole(data?.user?.role).map((key) => ({
        key,
        href: ALL_NAV_HREFS[key],
        ...navMeta[key],
    }))

    return (
        <aside className="flex h-screen w-60 shrink-0 flex-col bg-moon-abyss text-white">
            <div className="flex items-center gap-2.5 px-5 py-5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-moon-rose text-xs font-bold text-moon-violet-dark">
                    RR
                </div>
                <div>
                    <p className="text-sm font-bold leading-tight">Rapid Response</p>
                </div>
            </div>

            <p className="px-5 pb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/40">
                Navigation
            </p>

            <nav className="flex flex-1 flex-col gap-1 px-3">
                {items.map(({ href, label, icon: Icon }) => {
                    const active =
                        href === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(href)

                    return (
                        <Link
                            key={href}
                            href={href}
                            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                                active
                                    ? 'bg-moon-violet-dark font-semibold text-white'
                                    : 'text-white/70 hover:bg-white/5 hover:text-white'
                            }`}
                        >
                            <Icon size={17} strokeWidth={1.9} />
                            <span className="flex-1">{label}</span>
                        </Link>
                    )
                })}
            </nav>

            <div className="m-3 space-y-2">
                <div className="flex items-center gap-2.5 rounded-xl bg-white/5 p-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-moon-rose text-xs font-bold text-moon-violet-dark">
                        {initials || 'RR'}
                    </div>
                    <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{name}</p>
                        <p className="truncate text-[11px] text-white/50">{roleLabel}</p>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={() => void logoutCurrentSession()}
                    className="w-full rounded-lg px-3 py-2 text-left text-xs text-white/60 transition-colors hover:bg-white/5 hover:text-white"
                >
                    Se déconnecter
                </button>
            </div>
        </aside>
    )
}
