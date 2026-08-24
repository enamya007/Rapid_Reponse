'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { techniciansService } from '@/services/technicians.service'
import { techniciansKeys } from '@/keys/technicians.keys'
import type {
  CreateTechnicianInput,
  UpdateTechnicianInput,
  UpdateAvailabilityInput,
  SetTechnicianSkillsInput,
} from '@/schema/technician.schema'
import type { TechnicianListQuery } from '@/types/technician'

export const useTechnicians = (
  params?: TechnicianListQuery,
  options?: { enabled?: boolean },
) =>
  useQuery({
    queryKey: techniciansKeys.list(params),
    queryFn: () => techniciansService.list(params),
    enabled: options?.enabled ?? true,
  })

export const useTechnician = (id: string, options?: { enabled?: boolean }) =>
  useQuery({
    queryKey: techniciansKeys.detail(id),
    queryFn: () => techniciansService.getById(id),
    enabled: Boolean(id) && (options?.enabled ?? true),
  })

export const useCreateTechnician = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (body: CreateTechnicianInput) => techniciansService.create(body),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: techniciansKeys.lists() }),
  })
}

export const useUpdateTechnician = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateTechnicianInput }) =>
      techniciansService.update(id, body),
    onSuccess: (data, { id }) => {
      queryClient.setQueryData(techniciansKeys.detail(id), data)
      queryClient.invalidateQueries({ queryKey: techniciansKeys.lists() })
    },
  })
}

export const useUpdateMyAvailability = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (body: UpdateAvailabilityInput) =>
      techniciansService.updateMyAvailability(body),
    onSuccess: (data) => {
      queryClient.setQueryData(techniciansKeys.detail(data.id), data)
      queryClient.invalidateQueries({ queryKey: techniciansKeys.lists() })
    },
  })
}

export const useSetTechnicianSkills = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: SetTechnicianSkillsInput }) =>
      techniciansService.setSkills(id, body),
    onSuccess: (data, { id }) => {
      queryClient.setQueryData(techniciansKeys.detail(id), data)
      queryClient.invalidateQueries({ queryKey: techniciansKeys.lists() })
    },
  })
}
