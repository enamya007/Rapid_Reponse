import { ApiProperty } from '@nestjs/swagger';
import { User } from '../../users/entities/user.entity';

// Lightweight, nested representation of a `User` (owner/assignee) embedded in ticket
// responses. Deliberately narrower than `UserResponseDto`: never exposes `email`, `role`,
// `isActive`, and — like every response DTO in this codebase — never `password`.
export class UserSummaryDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  username: string;

  @ApiProperty({ nullable: true, type: String })
  firstName: string | null;

  @ApiProperty({ nullable: true, type: String })
  lastName: string | null;

  static fromEntity(user: User): UserSummaryDto {
    const dto = new UserSummaryDto();
    dto.id = user.id;
    dto.username = user.username;
    dto.firstName = user.firstName;
    dto.lastName = user.lastName;
    return dto;
  }
}
