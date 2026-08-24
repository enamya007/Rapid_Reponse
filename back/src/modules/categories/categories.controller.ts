import {
  Body,
  Controller,
  Get,
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
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Auth } from '../auth/decorators/auth.decorator';
import { UserRole } from '../users/enums/user-role.enum';
import { CategoriesService } from './categories.service';
import { CategoryQueryDto } from './dto/category-query.dto';
import { CategoryResponseDto } from './dto/category-response.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

// P6.5 contract §3 (`docs/plan-P6.5-contracts.md`) — figée. Reads are open to every
// authenticated role (D7): a CLIENT needs this list to fill the category field of the
// ticket-creation form, which `POST /tickets` requires. Writes are ADMIN-only.
@ApiTags('categories')
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Post()
  @Auth(UserRole.ADMIN)
  @ApiOperation({ summary: 'Create a ticket category (ADMIN only)' })
  @ApiCreatedResponse({ type: CategoryResponseDto })
  @ApiBadRequestResponse({
    description: 'Validation failed, or an unknown field was sent',
  })
  @ApiForbiddenResponse({ description: 'Caller is not an ADMIN' })
  @ApiNotFoundResponse({ description: 'The given requiredSkillId is unknown' })
  @ApiConflictResponse({
    description: 'A category with this name already exists',
  })
  async create(@Body() dto: CreateCategoryDto): Promise<CategoryResponseDto> {
    return this.categoriesService.create(dto);
  }

  @Get()
  @Auth()
  @ApiOperation({
    summary:
      'List categories, sorted by name ASC (not paginated). Available to every authenticated role.',
  })
  @ApiOkResponse({ type: CategoryResponseDto, isArray: true })
  async findAll(
    @Query() query: CategoryQueryDto,
  ): Promise<CategoryResponseDto[]> {
    return this.categoriesService.findAll(query);
  }

  @Get(':id')
  @Auth()
  @ApiOperation({ summary: 'Get a single category by id' })
  @ApiOkResponse({ type: CategoryResponseDto })
  @ApiNotFoundResponse({ description: 'Category not found' })
  async getById(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CategoryResponseDto> {
    return this.categoriesService.getById(id);
  }

  @Patch(':id')
  @Auth(UserRole.ADMIN)
  @ApiOperation({
    summary:
      'Update a category — including retiring it with isActive: false, which is how a category is removed (there is no DELETE, D6)',
  })
  @ApiOkResponse({ type: CategoryResponseDto })
  @ApiBadRequestResponse({ description: 'No field provided to update' })
  @ApiForbiddenResponse({ description: 'Caller is not an ADMIN' })
  @ApiNotFoundResponse({
    description: 'Category not found, or the given requiredSkillId is unknown',
  })
  @ApiConflictResponse({
    description: 'Another category already uses this name',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
  ): Promise<CategoryResponseDto> {
    return this.categoriesService.update(id, dto);
  }
}
