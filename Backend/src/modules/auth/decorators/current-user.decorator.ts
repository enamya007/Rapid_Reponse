import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { User } from '../../users/entities/user.entity';

interface RequestWithUser {
  user: User;
}

export const CurrentUser = createParamDecorator(
  (
    data: keyof User | undefined,
    ctx: ExecutionContext,
  ): User | User[keyof User] => {
    const request = ctx.switchToHttp().getRequest<RequestWithUser>();
    return data ? request.user[data] : request.user;
  },
);
