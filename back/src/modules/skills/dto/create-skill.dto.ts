import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length, MaxLength } from 'class-validator';

// P5 contract §5 (`docs/plan-P5-contracts.md`) — figée.
export class CreateSkillDto {
  @ApiProperty({
    example: 'Plomberie',
    minLength: 2,
    maxLength: 80,
  })
  @IsString()
  @Length(2, 80)
  name: string;

  @ApiPropertyOptional({
    example: 'Fuites, tuyauterie, sanitaires.',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}
