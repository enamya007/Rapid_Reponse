import { UserRole } from '../enums/user-role.enum';

export interface CreateUserData {
  username: string;
  email: string;
  passwordHash: string;
  role?: UserRole;
  firstName?: string;
  lastName?: string;
  phone?: string;
}
