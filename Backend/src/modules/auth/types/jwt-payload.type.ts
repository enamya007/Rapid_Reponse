import { UserRole } from '../../users/enums/user-role.enum';

export interface JwtPayload {
  sub: string;
  username: string;
  role: UserRole;
}

export interface RefreshTokenPayload {
  sub: string;
  jti: string;
}
