export type CategorySkillSummary = {
  id: string
  name: string
  description: string | null
}

export type Category = {
  id: string
  name: string
  description: string | null
  requiredSkill: CategorySkillSummary | null
  isActive: boolean
}

export type CategoryListQuery = {
  isActive?: boolean
}
