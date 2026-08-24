'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import type { UserRole } from '@/types/auth'

export default function RequireRole({
  roles,
  children,
}: {
  roles: UserRole[]
  children: React.ReactNode
}) {
  const { data, status } = useSession()
  const router = useRouter()
  const role = data?.user?.role
  const allowed = Boolean(role && roles.includes(role))

  useEffect(() => {
    if (status === 'authenticated' && !allowed) {
      router.replace('/dashboard')
    }
  }, [allowed, router, status])

  if (status === 'loading') {
    return <p className="text-sm text-moon-abyss/70">Chargement…</p>
  }

  if (!allowed) return null

  return children
}
