'use client'

import { getSession, signOut } from 'next-auth/react'
import { authService } from '@/services/auth.service'
import { setAccessToken, setRefreshToken } from '@/services/http/axios'

export async function logoutCurrentSession() {
  const session = await getSession()

  if (session?.refreshToken) {
    try {
      await authService.logout({ refreshToken: session.refreshToken })
    } catch {
      // The access token may already be invalid; still drop the local session.
    }
  }

  setAccessToken(null)
  setRefreshToken(null)
  await signOut({ callbackUrl: '/login' })
}
