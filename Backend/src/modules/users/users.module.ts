import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Ticket } from '../tickets/entities/ticket.entity';
import { User } from './entities/user.entity';
import { UsersAdminService } from './users-admin.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

// `Ticket` is registered for `UsersAdminService` alone (D4: refusing to soft-delete a user who
// is still the assignee of a live ticket). `UsersService` itself keeps its single `User`
// repository — see `users-admin.service.ts` for why the two are separate providers.
//
// `UsersAdminService` is deliberately NOT exported: nothing outside this module should be able
// to bypass `/users`' own guards by calling it directly.
@Module({
  imports: [TypeOrmModule.forFeature([User, Ticket])],
  controllers: [UsersController],
  providers: [UsersService, UsersAdminService],
  exports: [UsersService, TypeOrmModule],
})
export class UsersModule {}
