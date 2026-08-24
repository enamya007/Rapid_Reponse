'use client'

import { useEffect } from 'react'
import { signOut, useSession } from 'next-auth/react'
import {
  setAccessToken,
  setOnAuthFailure,
  setRefreshToken,
  setTokenPersistHandler,
} from '@/services/http/axios'

export function SessionTokenSync() {
  const { data, update } = useSession()

  useEffect(() => {
    setAccessToken(data?.accessToken ?? null)
    setRefreshToken(data?.refreshToken ?? null)
  }, [data?.accessToken, data?.refreshToken])

  useEffect(() => {
    setTokenPersistHandler((tokens) => {
      setAccessToken(tokens.accessToken)
      setRefreshToken(tokens.refreshToken)
      void update({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      })
    })
    setOnAuthFailure(() => {
      setAccessToken(null)
      setRefreshToken(null)
      void signOut({ callbackUrl: '/login' })
    })

    return () => {
      setTokenPersistHandler(null)
      setOnAuthFailure(null)
    }
  }, [update])

  return null
}
