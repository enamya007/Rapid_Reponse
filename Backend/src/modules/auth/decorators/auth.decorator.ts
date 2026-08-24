import { applyDecorators, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { UserRole } from '../../users/enums/user-role.enum';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { Roles } from './roles.decorator';

// Combines JWT authentication, role-based authorization and the matching Swagger
// annotations. `'access-token'` must match the security scheme name registered in
// `main.ts` (`addBearerAuth(..., 'access-token')`) for the Swagger "Authorize" button to work.
export function Auth(...roles: UserRole[]): ReturnType<typeof applyDecorators> {
  const decorators: Array<
    ClassDecorator | MethodDecorator | PropertyDecorator
  > = [
    UseGuards(JwtAuthGuard, RolesGuard),
    Roles(...roles),
    ApiBearerAuth('access-token'),
    ApiUnauthorizedResponse({ description: 'Missing or invalid access token' }),
  ];

  if (roles.length > 0) {
    decorators.push(
      ApiForbiddenResponse({ description: 'Insufficient role permissions' }),
    );
  }

  return applyDecorators(...decorators);
}
