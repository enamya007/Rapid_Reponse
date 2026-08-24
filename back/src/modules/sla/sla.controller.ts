import {
  Body,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  Put,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Auth } from '../auth/decorators/auth.decorator';
import { TicketPriority } from '../tickets/enums/ticket-priority.enum';
import { UserRole } from '../users/enums/user-role.enum';
import { SlaPolicyResponseDto } from './dto/sla-policy-response.dto';
import { UpsertSlaPolicyDto } from './dto/upsert-sla-policy.dto';
import { SlaService } from './sla.service';

// P6.5 contract §3 (`docs/plan-P6.5-contracts.md`) — figée. Reading is open to every
// authenticated role (D9): the resolution target is a commitment made to the requester, not an
// operational secret. Writing is ADMIN-only.
@ApiTags('sla-policies')
@Controller('sla-policies')
export class SlaController {
  constructor(private readonly slaService: SlaService) {}

  @Get()
  @Auth()
  @ApiOperation({
    summary:
      'List the SLA policies, ordered CRITICAL, HIGH, NORMAL, LOW (not paginated: one row per priority)',
  })
  @ApiOkResponse({ type: SlaPolicyResponseDto, isArray: true })
  async findAll(): Promise<SlaPolicyResponseDto[]> {
    return this.slaService.findAll();
  }

  // PUT, not PATCH: the resource is a single value keyed by priority, and the route creates it
  // when absent (D8). PATCH would imply a partial update of something that may not exist yet.
  @Put(':priority')
  @Auth(UserRole.ADMIN)
  @ApiOperation({
    summary:
      'Set the resolution target for a priority (ADMIN only). Creates the policy if that priority has none. Applies to tickets created afterwards only.',
  })
  @ApiParam({
    name: 'priority',
    enum: TicketPriority,
    enumName: 'TicketPriority',
  })
  @ApiOkResponse({ type: SlaPolicyResponseDto })
  @ApiBadRequestResponse({
    description:
      'Unknown priority, resolutionTargetMinutes missing/out of range, or an unknown field was sent',
  })
  @ApiForbiddenResponse({ description: 'Caller is not an ADMIN' })
  async upsert(
    @Param('priority', new ParseEnumPipe(TicketPriority))
    priority: TicketPriority,
    @Body() dto: UpsertSlaPolicyDto,
  ): Promise<SlaPolicyResponseDto> {
    return this.slaService.upsert(priority, dto);
  }
}
