import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
} from 'class-validator';
import { TicketPriority } from '../enums/ticket-priority.enum';

// All fields optional (P4 contract §5): `TicketsService.update` is the one enforcing "at least
// one field must be present" — a DTO-level rule can't express "not ALL absent" with
// `class-validator` alone. `status` is deliberately NOT part of this DTO: it is never mutable
// through `PATCH /tickets/:id`, only through the dedicated transition endpoints (T4.4).
export class UpdateTicketDto {
  @ApiPropertyOptional({
    example: 'Panne de climatisation salle serveur',
    minLength: 3,
    maxLength: 150,
  })
  @IsOptional()
  @IsString()
  @Length(3, 150)
  title?: string;

  @ApiPropertyOptional({
    example: 'La climatisation ne démarre plus depuis ce matin.',
    minLength: 1,
    maxLength: 5000,
  })
  @IsOptional()
  @IsString()
  @Length(1, 5000)
  description?: string;

  @ApiPropertyOptional({ enum: TicketPriority, enumName: 'TicketPriority' })
  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ maxLength: 150 })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  siteLabel?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  siteAddress?: string;
}
