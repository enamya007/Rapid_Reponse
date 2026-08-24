import type { UserRole } from '@/types/auth'
import { DefaultSession } from 'next-auth'

declare module 'next-auth' {
  interface Session {
    accessToken: string
    refreshToken: string
    user: {
      id: string
      email: string
      role: UserRole
    } & DefaultSession['user']
  }

  interface User {
    id: string
    email: string
    name?: string | null
    accessToken: string
    refreshToken: string
    role: UserRole
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string
    role: UserRole
    accessToken: string
    refreshToken: string
  }
}
