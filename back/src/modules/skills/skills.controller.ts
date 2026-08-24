import { Body, Controller, Get, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Auth } from '../auth/decorators/auth.decorator';
import { UserRole } from '../users/enums/user-role.enum';
import { CreateSkillDto } from './dto/create-skill.dto';
import { SkillResponseDto } from './dto/skill-response.dto';
import { SkillsService } from './skills.service';

@ApiTags('skills')
@Controller('skills')
export class SkillsController {
  constructor(private readonly skillsService: SkillsService) {}

  @Post()
  @Auth(UserRole.ADMIN)
  @ApiOperation({ summary: 'Create a new skill (ADMIN only)' })
  @ApiCreatedResponse({ type: SkillResponseDto })
  @ApiBadRequestResponse({
    description:
      'name missing/too short/too long, description too long, or an unknown field was sent',
  })
  @ApiForbiddenResponse({ description: 'Caller is not an ADMIN' })
  @ApiConflictResponse({
    description: 'A skill with this name already exists',
  })
  async create(@Body() dto: CreateSkillDto): Promise<SkillResponseDto> {
    const skill = await this.skillsService.create(dto);
    return SkillResponseDto.fromEntity(skill);
  }

  @Get()
  @Auth()
  @ApiOperation({
    summary: 'List every skill, sorted by name ASC (not paginated)',
  })
  @ApiOkResponse({ type: SkillResponseDto, isArray: true })
  async findAll(): Promise<SkillResponseDto[]> {
    const skills = await this.skillsService.findAll();
    return skills.map((skill) => SkillResponseDto.fromEntity(skill));
  }
}
