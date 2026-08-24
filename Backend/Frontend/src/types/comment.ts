export type CommentVisibility = 'PUBLIC' | 'INTERNAL'

export type CommentAuthor = {
  id: string
  username: string
}

export type Comment = {
  id: string
  body: string
  visibility: CommentVisibility
  author: CommentAuthor | null
  createdAt: string
}
