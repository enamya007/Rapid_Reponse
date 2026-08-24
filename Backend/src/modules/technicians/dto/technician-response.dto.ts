import { ApiProperty } from '@nestjs/swagger';
import { User } from '../../users/entities/user.entity';
import { TechnicianSkillResponseDto } from './technician-skill-response.dto';

// P5 contract §5 (`docs/plan-P5-contracts.md`) — figée:
// `{ id, username, email, firstName, lastName, phone, isActive, isAvailable,
// maxConcurrentTickets, currentLoad, skills }`.
//
// D4: `id` is the **userId**, never `TechnicianProfile.id` — `fromEntity` never reads
// `profile.id` for any exposed field, on purpose. Never `password`, never `deletedAt`.
export class TechnicianResponseDto {
  @ApiProperty({
    description: "The technician's userId (D4), not TechnicianProfile.id",
  })
  id: string;

  @ApiProperty()
  username: string;

  @ApiProperty()
  email: string;

  @ApiProperty({ type: String, nullable: true })
  firstName: string | null;

  @ApiProperty({ type: String, nullable: true })
  lastName: string | null;

  @ApiProperty({ type: String, nullable: true })
  phone: string | null;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty()
  isAvailable: boolean;

  @ApiProperty()
  maxConcurrentTickets: number;

  // D3 (`docs/plan-P5-contracts.md` §2): number of non-soft-deleted tickets assigned to this
  // technician with status ASSIGNED or IN_PROGRESS. Always supplied by the caller
  // (`TechniciansService`), computed in SQL — never derived here.
  @ApiProperty()
  currentLoad: number;

  @ApiProperty({ type: () => [TechnicianSkillResponseDto] })
  skills: TechnicianSkillResponseDto[];

  static fromEntity(
    user: User,
    profile: { isAvailable: boolean; maxConcurrentTickets: number },
    currentLoad: number,
    skills: TechnicianSkillResponseDto[],
  ): TechnicianResponseDto {
    const dto = new TechnicianResponseDto();
    dto.id = user.id;
    dto.username = user.username;
    dto.email = user.email;
    dto.firstName = user.firstName;
    dto.lastName = user.lastName;
    dto.phone = user.phone;
    dto.isActive = user.isActive;
    dto.isAvailable = profile.isAvailable;
    dto.maxConcurrentTickets = profile.maxConcurrentTickets;
    dto.currentLoad = currentLoad;
    dto.skills = skills;
    return dto;
  }
}
