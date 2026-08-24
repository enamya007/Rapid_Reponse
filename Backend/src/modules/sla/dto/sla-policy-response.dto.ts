import { ApiProperty } from '@nestjs/swagger';
import { TicketPriority } from '../../tickets/enums/ticket-priority.enum';
import { SlaPolicy } from '../entities/sla-policy.entity';

// Manual response DTO with `fromEntity`, per the project-wide convention. The row's `id` is
// deliberately NOT exposed: `priority` is unique and is the key every route uses
// (`PUT /sla-policies/:priority`), so publishing a second identifier would only invite callers
// to address the same row two different ways.
export class SlaPolicyResponseDto {
  @ApiProperty({ enum: TicketPriority, enumName: 'TicketPriority' })
  priority: TicketPriority;

  @ApiProperty({
    example: 240,
    description:
      'Resolution target, in minutes from ticket creation. Applies to tickets created AFTER the last change (D8).',
  })
  resolutionTargetMinutes: number;

  @ApiProperty()
  updatedAt: Date;

  static fromEntity(policy: SlaPolicy): SlaPolicyResponseDto {
    const dto = new SlaPolicyResponseDto();
    dto.priority = policy.priority;
    dto.resolutionTargetMinutes = policy.resolutionTargetMinutes;
    dto.updatedAt = policy.updatedAt;
    return dto;
  }
}
