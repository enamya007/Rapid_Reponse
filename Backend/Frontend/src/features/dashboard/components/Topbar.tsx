'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { Bell, ChevronDown } from 'lucide-react'
import type { UserRole } from '@/types/auth'
import {
    useNotifications,
    useUnreadCount,
    useMarkNotificationRead,
    useReadAllNotifications,
} from '@/hooks/useNotifications'
import { formatDate } from '@/features/tickets/ticketUi'

const sectionLabels: Record<string, string> = {
    '/dashboard': 'Tableau de bord',
    '/dashboard/tickets': 'Tickets',
    '/dashboard/techniciens': 'Techniciens',
    '/dashboard/utilisateurs': 'Utilisateurs',
    '/dashboard/statistiques': 'Statistiques',
    '/dashboard/parametres': 'Paramètres',
}

const roleLabels: Record<UserRole, string> = {
    ADMIN: 'Admin',
    TECHNICIAN: 'Technicien',
    CLIENT: 'Client',
}

export default function Topbar() {
    const pathname = usePathname()
    const { data } = useSession()
    const roleLabel = data?.user?.role ? roleLabels[data.user.role] : 'Compte'
    const section = pathname.startsWith('/dashboard/tickets/')
        ? 'Détail ticket'
        : (Object.entries(sectionLabels)
              .sort((a, b) => b[0].length - a[0].length)
              .find(([href]) => pathname.startsWith(href))?.[1] ?? 'Tableau de bord')

    const [open, setOpen] = useState(false)
    const panelRef = useRef<HTMLDivElement>(null)
    const unreadQuery = useUnreadCount()
    const listQuery = useNotifications({ page: 1, limit: 10 }, { enabled: open })
    const markRead = useMarkNotificationRead()
    const readAll = useReadAllNotifications()
    const unread = unreadQuery.data?.count ?? 0
    const notifications = listQuery.data?.data ?? []

    useEffect(() => {
        if (!open) return
        const onClick = (e: MouseEvent) => {
            if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
                setOpen(false)
            }
        }
        document.addEventListener('mousedown', onClick)
        return () => document.removeEventListener('mousedown', onClick)
    }, [open])

    return (
        <header className="flex items-center justify-between border-b border-moon-abyss/10 bg-white px-6 py-3">
            <div className="flex items-center gap-1.5 text-sm">
                <span className="flex items-center gap-2 text-moon-abyss/70">
                    {roleLabel}
                    <ChevronDown size={14} />
                </span>
                <span className="text-moon-abyss/65">/</span>
                <span className="font-semibold text-moon-abyss">{section}</span>
            </div>

            <div className="flex items-center gap-3">
                <div className="relative" ref={panelRef}>
                    <button
                        type="button"
                        aria-label="Notifications"
                        aria-expanded={open}
                        onClick={() => setOpen((v) => !v)}
                        className="relative rounded-full border border-moon-rose/50 bg-moon-rose/30 p-2 text-moon-violet transition-colors hover:bg-moon-rose/50"
                    >
                        <Bell size={17} />
                        {unread > 0 && (
                            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-moon-violet px-1 text-[9px] font-bold text-white">
                                {unread > 9 ? '9+' : unread}
                            </span>
                        )}
                    </button>
                    {open && (
                        <div className="absolute right-0 z-30 mt-2 w-80 overflow-hidden rounded-2xl border border-moon-abyss/10 bg-white shadow-xl">
                            <div className="flex items-center justify-between border-b border-moon-abyss/8 px-3 py-2">
                                <p className="text-sm font-semibold text-moon-abyss">Notifications</p>
                                <button
                                    type="button"
                                    onClick={() => readAll.mutate()}
                                    disabled={unread === 0 || readAll.isPending}
                                    className="text-xs font-medium text-moon-violet disabled:opacity-40"
                                >
                                    Tout lu
                                </button>
                            </div>
                            <ul className="max-h-80 overflow-y-auto">
                                {listQuery.isLoading && (
                                    <li className="px-3 py-4 text-sm text-moon-abyss/70">Chargement…</li>
                                )}
                                {notifications.map((n) => {
                                    const inner = (
                                        <>
                                            <p className="text-sm font-medium text-moon-abyss">{n.title}</p>
                                            <p className="mt-0.5 line-clamp-2 text-xs text-moon-abyss/60">
                                                {n.body}
                                            </p>
                                            <p className="mt-1 font-mono text-[10px] text-moon-abyss/65">
                                                {formatDate(n.createdAt)}
                                                {n.ticketReference ? ` · ${n.ticketReference}` : ''}
                                            </p>
                                        </>
                                    )
                                    return (
                                        <li key={n.id}>
                                            {n.ticketId ? (
                                                <Link
                                                    href={`/dashboard/tickets/${n.ticketId}`}
                                                    onClick={() => {
                                                        if (!n.readAt) markRead.mutate(n.id)
                                                        setOpen(false)
                                                    }}
                                                    className={`block px-3 py-2.5 hover:bg-moon-rose/20 ${
                                                        n.readAt ? '' : 'bg-moon-rose/25'
                                                    }`}
                                                >
                                                    {inner}
                                                </Link>
                                            ) : (
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        if (!n.readAt) markRead.mutate(n.id)
                                                    }}
                                                    className={`block w-full px-3 py-2.5 text-left hover:bg-moon-rose/20 ${
                                                        n.readAt ? '' : 'bg-moon-rose/25'
                                                    }`}
                                                >
                                                    {inner}
                                                </button>
                                            )}
                                        </li>
                                    )
                                })}
                                {!listQuery.isLoading && notifications.length === 0 && (
                                    <li className="px-3 py-4 text-sm text-moon-abyss/70">
                                        Aucune notification.
                                    </li>
                                )}
                            </ul>
                        </div>
                    )}
                </div>
            </div>
        </header>
    )
}
