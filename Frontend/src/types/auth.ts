export type UserRole = 'ADMIN' | 'TECHNICIAN' | 'CLIENT'

export type UserListQuery = {
  page?: number
  limit?: number
  role?: UserRole
  isActive?: boolean
  search?: string
}

export type User = {
    id: string
    username: string
    email: string
    firstName: string | null
    lastName: string | null
    phone: string | null
    role: UserRole
    isActive: boolean
    createdAt: string
}

export type AuthResponse = {
    accessToken: string
    refreshToken: string
    user: User
}