import { ApiProperty } from '@nestjs/swagger';
import { User } from '../entities/user.entity';
import { UserRole } from '../enums/user-role.enum';

export class UserResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  username: string;

  @ApiProperty()
  email: string;

  @ApiProperty({ nullable: true, type: String })
  firstName: string | null;

  @ApiProperty({ nullable: true, type: String })
  lastName: string | null;

  @ApiProperty({ nullable: true, type: String })
  phone: string | null;

  @ApiProperty({ enum: UserRole, enumName: 'UserRole' })
  role: UserRole;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty()
  createdAt: Date;

  static fromEntity(user: User): UserResponseDto {
    const dto = new UserResponseDto();
    dto.id = user.id;
    dto.username = user.username;
    dto.email = user.email;
    dto.firstName = user.firstName;
    dto.lastName = user.lastName;
    dto.phone = user.phone;
    dto.role = user.role;
    dto.isActive = user.isActive;
    dto.createdAt = user.createdAt;
    return dto;
  }
}
