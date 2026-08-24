import type { UserRole } from '@/types/auth'

export const ADMIN_ONLY_PREFIXES = [
  '/dashboard/techniciens',
  '/dashboard/utilisateurs',
  '/dashboard/statistiques',
] as const

export function isAdminOnlyPath(pathname: string): boolean {
  return ADMIN_ONLY_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )
}

export function canAccessPath(role: UserRole | undefined, pathname: string): boolean {
  if (!role) return false
  if (isAdminOnlyPath(pathname)) return role === 'ADMIN'
  return true
}

export type NavItemKey =
  | 'tickets'
  | 'dashboard'
  | 'techniciens'
  | 'utilisateurs'
  | 'statistiques'
  | 'parametres'

export const ALL_NAV_HREFS: Record<NavItemKey, string> = {
  tickets: '/dashboard/tickets',
  dashboard: '/dashboard',
  techniciens: '/dashboard/techniciens',
  utilisateurs: '/dashboard/utilisateurs',
  statistiques: '/dashboard/statistiques',
  parametres: '/dashboard/parametres',
}

export function navKeysForRole(role: UserRole | undefined): NavItemKey[] {
  if (role === 'ADMIN') {
    return [
      'dashboard',
      'tickets',
      'techniciens',
      'utilisateurs',
      'statistiques',
      'parametres',
    ]
  }

  return ['dashboard', 'tickets', 'parametres']
}
