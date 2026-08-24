import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  ApiPaginatedResponse,
  PaginatedResponseDto,
} from '../../common/dto/paginated-response.dto';
import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserQueryDto } from './dto/user-query.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { User } from './entities/user.entity';
import { UserRole } from './enums/user-role.enum';
import { UsersAdminService } from './users-admin.service';

// P6.5 contract §3 (`docs/plan-P6.5-contracts.md`) — figée. Every route is ADMIN-only: this is
// the "Gestion des utilisateurs (création/désactivation)" the cahier des charges §3 attributes
// to that role alone. A user reading or editing their OWN account goes through `/auth/me`, not
// here.
@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersAdminService: UsersAdminService) {}

  @Post()
  @Auth(UserRole.ADMIN)
  @ApiOperation({ summary: 'Create a user account (ADMIN only)' })
  @ApiCreatedResponse({ type: UserResponseDto })
  @ApiBadRequestResponse({
    description:
      'Validation failed, an unknown field was sent, or role is TECHNICIAN (use POST /technicians instead)',
  })
  @ApiForbiddenResponse({ description: 'Caller is not an ADMIN' })
  @ApiConflictResponse({ description: 'username or email already in use' })
  async create(@Body() dto: CreateUserDto): Promise<UserResponseDto> {
    return this.usersAdminService.create(dto);
  }

  @Get()
  @Auth(UserRole.ADMIN)
  @ApiOperation({
    summary:
      'List user accounts, paginated and filtered, sorted by username ASC (ADMIN only). Soft-deleted accounts are excluded.',
  })
  @ApiPaginatedResponse(UserResponseDto)
  @ApiForbiddenResponse({ description: 'Caller is not an ADMIN' })
  async list(
    @Query() query: UserQueryDto,
  ): Promise<PaginatedResponseDto<UserResponseDto>> {
    return this.usersAdminService.list(query);
  }

  @Get(':id')
  @Auth(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get a single user account by id (ADMIN only)' })
  @ApiOkResponse({ type: UserResponseDto })
  @ApiForbiddenResponse({ description: 'Caller is not an ADMIN' })
  @ApiNotFoundResponse({ description: 'User not found' })
  async getById(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<UserResponseDto> {
    return this.usersAdminService.getById(id);
  }

  @Patch(':id')
  @Auth(UserRole.ADMIN)
  @ApiOperation({
    summary:
      'Update a user account — profile fields, role (ADMIN <-> CLIENT only) and activation (ADMIN only)',
  })
  @ApiOkResponse({ type: UserResponseDto })
  @ApiBadRequestResponse({
    description:
      'No field provided, a role change to/from TECHNICIAN, or an attempt by the caller to change their own role/activation',
  })
  @ApiForbiddenResponse({ description: 'Caller is not an ADMIN' })
  @ApiNotFoundResponse({ description: 'User not found' })
  @ApiConflictResponse({ description: 'username or email already in use' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() currentUser: User,
  ): Promise<UserResponseDto> {
    return this.usersAdminService.update(id, dto, currentUser);
  }

  @Delete(':id')
  @Auth(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Soft-delete a user account (ADMIN only). The row is kept so tickets and history stay traceable.',
  })
  @ApiNoContentResponse({ description: 'Account soft-deleted' })
  @ApiBadRequestResponse({ description: 'An ADMIN cannot delete themselves' })
  @ApiForbiddenResponse({ description: 'Caller is not an ADMIN' })
  @ApiNotFoundResponse({ description: 'User not found' })
  @ApiConflictResponse({
    description: 'The user is still assigned to open tickets',
  })
  async softDelete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: User,
  ): Promise<void> {
    return this.usersAdminService.softDelete(id, currentUser);
  }
}
