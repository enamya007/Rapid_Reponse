import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
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
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/enums/user-role.enum';
import { CreateTechnicianDto } from './dto/create-technician.dto';
import { SetTechnicianSkillsDto } from './dto/set-technician-skills.dto';
import { TechnicianQueryDto } from './dto/technician-query.dto';
import { TechnicianResponseDto } from './dto/technician-response.dto';
import { UpdateAvailabilityDto } from './dto/update-availability.dto';
import { UpdateTechnicianDto } from './dto/update-technician.dto';
import { TechniciansService } from './technicians.service';

@ApiTags('technicians')
@Controller('technicians')
export class TechniciansController {
  constructor(private readonly techniciansService: TechniciansService) {}

  @Post()
  @Auth(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Create a technician account and profile (ADMIN only)',
  })
  @ApiCreatedResponse({ type: TechnicianResponseDto })
  @ApiBadRequestResponse({
    description:
      'Validation failed (missing/invalid field, or an unknown field was sent)',
  })
  @ApiForbiddenResponse({ description: 'Caller is not an ADMIN' })
  @ApiConflictResponse({ description: 'username or email already in use' })
  @ApiNotFoundResponse({
    description:
      'One or more of the given skillIds do not exist (no user is created in that case)',
  })
  async create(
    @Body() dto: CreateTechnicianDto,
  ): Promise<TechnicianResponseDto> {
    return this.techniciansService.create(dto);
  }

  @Get()
  @Auth(UserRole.ADMIN)
  @ApiOperation({
    summary: 'List technicians, paginated and filtered (ADMIN only)',
  })
  @ApiPaginatedResponse(TechnicianResponseDto)
  @ApiForbiddenResponse({ description: 'Caller is not an ADMIN' })
  async list(
    @Query() query: TechnicianQueryDto,
  ): Promise<PaginatedResponseDto<TechnicianResponseDto>> {
    return this.techniciansService.list(query);
  }

  // D10 (`docs/plan-P5-contracts.md` §2) declares this route before `GET /:id`/`PATCH /:id`
  // below as zero-cost defensive discipline against NestJS resolving routes in DECLARATION
  // order rather than by specificity. For THIS specific route, `/technicians/:id` (two path
  // segments) cannot actually collide with `/technicians/me/availability` (three segments) —
  // the original collision justification for D10 was checked and found false (see the
  // implementer's report on T5.1b), and the contract has been corrected accordingly. The order
  // is kept anyway: it costs nothing and remains relevant the day a two-segment
  // `GET /technicians/me` is ever added.
  @Patch('me/availability')
  @Auth(UserRole.TECHNICIAN)
  @ApiOperation({
    summary: "Update the caller's own technician availability",
  })
  @ApiOkResponse({ type: TechnicianResponseDto })
  @ApiBadRequestResponse({ description: 'isAvailable missing/invalid' })
  @ApiForbiddenResponse({ description: 'Caller is not a TECHNICIAN' })
  @ApiNotFoundResponse({ description: 'Caller has no technician profile' })
  async updateMyAvailability(
    @Body() dto: UpdateAvailabilityDto,
    @CurrentUser() user: User,
  ): Promise<TechnicianResponseDto> {
    return this.techniciansService.updateAvailability(user.id, dto);
  }

  @Get(':id')
  @Auth(UserRole.ADMIN, UserRole.TECHNICIAN)
  @ApiOperation({
    summary:
      'Get a single technician by id (userId, D4) — ADMIN reads any technician, a TECHNICIAN only their own',
  })
  @ApiOkResponse({ type: TechnicianResponseDto })
  @ApiForbiddenResponse({
    description:
      'Caller is a CLIENT, or a TECHNICIAN requesting a profile other than their own',
  })
  @ApiNotFoundResponse({ description: 'Technician not found' })
  async getById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ): Promise<TechnicianResponseDto> {
    return this.techniciansService.getByIdForCaller(id, user);
  }

  @Patch(':id')
  @Auth(UserRole.ADMIN)
  @ApiOperation({
    summary:
      'Update a technician (availability, capacity, and/or account activation — ADMIN only)',
  })
  @ApiOkResponse({ type: TechnicianResponseDto })
  @ApiBadRequestResponse({ description: 'No field provided to update' })
  @ApiForbiddenResponse({ description: 'Caller is not an ADMIN' })
  @ApiNotFoundResponse({ description: 'Technician not found' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTechnicianDto,
  ): Promise<TechnicianResponseDto> {
    return this.techniciansService.update(id, dto);
  }

  @Put(':id/skills')
  @Auth(UserRole.ADMIN)
  @ApiOperation({
    summary:
      "Replace a technician's full skill set (ADMIN only) — previous skills are discarded",
  })
  @ApiOkResponse({ type: TechnicianResponseDto })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiForbiddenResponse({ description: 'Caller is not an ADMIN' })
  @ApiNotFoundResponse({
    description: 'Technician not found, or one or more skillIds do not exist',
  })
  async setSkills(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetTechnicianSkillsDto,
  ): Promise<TechnicianResponseDto> {
    return this.techniciansService.setSkills(id, dto);
  }
}
