import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
} from 'class-validator';
import { TicketPriority } from '../enums/ticket-priority.enum';

export class CreateTicketDto {
  @ApiProperty({
    example: 'Panne de climatisation salle serveur',
    minLength: 3,
    maxLength: 150,
  })
  @IsString()
  @Length(3, 150)
  title: string;

  @ApiProperty({
    example: 'La climatisation ne démarre plus depuis ce matin.',
    minLength: 1,
    maxLength: 5000,
  })
  @IsString()
  @Length(1, 5000)
  description: string;

  // Defaulted to `NORMAL` by `TicketsService.create` when omitted, never here: this DTO only
  // validates what was actually sent, it does not decide business defaults.
  @ApiPropertyOptional({
    enum: TicketPriority,
    enumName: 'TicketPriority',
    default: TicketPriority.NORMAL,
  })
  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  categoryId: string;

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
