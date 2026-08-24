import type { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import { authService } from '@/services/auth.service'

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        identifier: { label: 'Identifiant', type: 'text' },
        password: { label: 'Mot de passe', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.identifier || !credentials?.password) {
          return null
        }

        try {
          const data = await authService.login({
            identifier: credentials.identifier,
            password: credentials.password,
          })

          return {
            id: data.user.id,
            email: data.user.email,
            name: data.user.username,
            role: data.user.role,
            accessToken: data.accessToken,
            refreshToken: data.refreshToken,
          }
        } catch {
          return null
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.id = user.id
        token.role = user.role
        token.accessToken = user.accessToken
        token.refreshToken = user.refreshToken
      }

      if (trigger === 'update' && session) {
        const next = session as { accessToken?: string; refreshToken?: string }
        if (next.accessToken) token.accessToken = next.accessToken
        if (next.refreshToken) token.refreshToken = next.refreshToken
      }

      return token
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken
      session.refreshToken = token.refreshToken

      if (session.user) {
        session.user.id = token.id
        session.user.role = token.role
      }

      return session
    },
  },
  session: {
    strategy: 'jwt',
  },
  pages: {
    signIn: '/login',
  },
}
