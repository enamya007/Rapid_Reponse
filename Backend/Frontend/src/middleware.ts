import { withAuth } from 'next-auth/middleware'
import { NextResponse } from 'next/server'
import { isAdminOnlyPath } from '@/lib/roles'

export default withAuth(
  function middleware(req) {
    const role = req.nextauth.token?.role
    const pathname = req.nextUrl.pathname

    if (role !== 'ADMIN' && isAdminOnlyPath(pathname)) {
      return NextResponse.redirect(new URL('/dashboard', req.url))
    }

    return NextResponse.next()
  },
  {
    pages: {
      signIn: '/login',
    },
  },
)

export const config = {
  matcher: ['/dashboard', '/dashboard/:path*'],
}
