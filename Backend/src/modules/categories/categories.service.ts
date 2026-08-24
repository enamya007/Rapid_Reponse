import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { isUniqueViolation } from '../../common/database/unique-violation.util';
import { Skill } from '../skills/entities/skill.entity';
import { CategoryQueryDto } from './dto/category-query.dto';
import { CategoryResponseDto } from './dto/category-response.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { Category } from './entities/category.entity';

// P6.5 contract §3 (`docs/plan-P6.5-contracts.md`) — figée. `categories.name` is `unique` at the
// DB level and case-SENSITIVE, exactly like the SQL constraint: this service reproduces that
// behaviour rather than inventing a case-insensitive rule the database would not enforce (same
// choice, and same reasoning, as `SkillsService`).
@Injectable()
export class CategoriesService {
  constructor(
    @InjectRepository(Category)
    private readonly categoryRepository: Repository<Category>,
    @InjectRepository(Skill)
    private readonly skillRepository: Repository<Skill>,
  ) {}

  // `GET /categories` — the `requiredSkill` relation is loaded in the SAME query (TypeORM emits
  // one LEFT JOIN), never one lookup per row.
  async findAll(query: CategoryQueryDto): Promise<CategoryResponseDto[]> {
    const where: FindOptionsWhere<Category> = {};
    if (query.isActive !== undefined) {
      where.isActive = query.isActive;
    }

    const categories = await this.categoryRepository.find({
      where,
      relations: { requiredSkill: true },
      order: { name: 'ASC' },
    });

    return categories.map((category) =>
      CategoryResponseDto.fromEntity(category),
    );
  }

  // `GET /categories/:id` — returns inactive categories too: an ADMIN must be able to open a
  // retired category to reactivate it, and a client following a link from a historical ticket
  // must not get a 404 for a category that still exists.
  async getById(id: string): Promise<CategoryResponseDto> {
    return CategoryResponseDto.fromEntity(await this.loadOrFail(id));
  }

  async create(dto: CreateCategoryDto): Promise<CategoryResponseDto> {
    if (dto.requiredSkillId) {
      await this.assertSkillExists(dto.requiredSkillId);
    }

    const existing = await this.categoryRepository.findOne({
      where: { name: dto.name },
    });
    if (existing) {
      throw new ConflictException(
        `A category named "${dto.name}" already exists`,
      );
    }

    const category = this.categoryRepository.create({
      name: dto.name,
      description: dto.description ?? null,
      requiredSkillId: dto.requiredSkillId ?? null,
    });

    let saved: Category;
    try {
      saved = await this.categoryRepository.save(category);
    } catch (error) {
      // The pre-check above narrows the common case, but two concurrent requests could both
      // pass it before either commits — the DB's own unique constraint is the real guarantee.
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          `A category named "${dto.name}" already exists`,
        );
      }
      throw error;
    }

    // Re-read through `getById` so `requiredSkill` is populated: `save()` returns the entity as
    // it was written (relation id only), and the response contract nests the whole skill.
    return this.getById(saved.id);
  }

  async update(
    id: string,
    dto: UpdateCategoryDto,
  ): Promise<CategoryResponseDto> {
    const hasAnyField =
      dto.name !== undefined ||
      dto.description !== undefined ||
      dto.requiredSkillId !== undefined ||
      dto.isActive !== undefined;
    if (!hasAnyField) {
      throw new BadRequestException(
        'At least one field must be provided to update a category',
      );
    }

    const category = await this.loadOrFail(id);

    // `!== undefined` and not a truthiness test: `null` is a meaningful value here (clear the
    // required skill), and it must not be confused with "key absent from the patch".
    if (dto.requiredSkillId !== undefined && dto.requiredSkillId !== null) {
      await this.assertSkillExists(dto.requiredSkillId);
    }

    if (dto.name !== undefined && dto.name !== category.name) {
      const conflict = await this.categoryRepository.findOne({
        where: { name: dto.name },
      });
      if (conflict) {
        throw new ConflictException(
          `A category named "${dto.name}" already exists`,
        );
      }
      category.name = dto.name;
    }
    if (dto.description !== undefined) {
      category.description = dto.description;
    }
    if (dto.requiredSkillId !== undefined) {
      category.requiredSkillId = dto.requiredSkillId;
      // Cleared alongside the id: TypeORM persists from `requiredSkillId`, but leaving the
      // stale relation object loaded would make the DTO built below report the OLD skill.
      category.requiredSkill = null;
    }
    if (dto.isActive !== undefined) {
      category.isActive = dto.isActive;
    }

    try {
      await this.categoryRepository.save(category);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          `A category named "${dto.name ?? category.name}" already exists`,
        );
      }
      throw error;
    }

    return this.getById(id);
  }

  private async loadOrFail(id: string): Promise<Category> {
    const category = await this.categoryRepository.findOne({
      where: { id },
      relations: { requiredSkill: true },
    });
    if (!category) {
      throw new NotFoundException('Category not found');
    }
    return category;
  }

  // 404 rather than 400: the request is well-formed, it points at a skill that does not exist —
  // same treatment `TicketsService` gives an unknown `categoryId`.
  private async assertSkillExists(skillId: string): Promise<void> {
    const exists = await this.skillRepository.existsBy({ id: skillId });
    if (!exists) {
      throw new NotFoundException('Skill not found');
    }
  }
}
