import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class LoginDto {
  // Accepts either the username or the email: `AuthService.login` resolves whichever one
  // matches, so the client never needs to know which kind of value it is sending.
  @ApiProperty({ example: 'jdoe', description: 'Username or email' })
  @IsString()
  @IsNotEmpty()
  identifier: string;

  @ApiProperty({ example: 'Str0ngP@ssw0rd' })
  @IsString()
  @IsNotEmpty()
  password: string;
}
