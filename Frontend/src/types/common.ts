export type PaginationMeta = {
  total: number
  page: number
  limit: number
  totalPages: number
}

export type Paginated<T> = {
  data: T[]
  meta: PaginationMeta
}

export type PaginationQuery = {
  page?: number
  limit?: number
}
