export const skillsKeys = {
  all: ['skills'] as const,
  list: () => [...skillsKeys.all, 'list'] as const,
}
