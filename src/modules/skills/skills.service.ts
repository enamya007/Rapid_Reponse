import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { isUniqueViolation } from '../../common/database/unique-violation.util';
import { CreateSkillDto } from './dto/create-skill.dto';
import { Skill } from './entities/skill.entity';

// P5 contract §3/§4 (`docs/plan-P5-contracts.md`) — figée. `skills.name` is `unique` at the DB
// level (`docs/data-model.md` §2.3), sensitive to case exactly like the SQL constraint itself:
// this service reproduces that behaviour, it does not attempt to be case-insensitive.
@Injectable()
export class SkillsService {
  constructor(
    @InjectRepository(Skill)
    private readonly skillRepository: Repository<Skill>,
  ) {}

  // Uniqueness is enforced twice on purpose: the `findOne` pre-check below gives a clean 409
  // for the common case, but two concurrent requests could both pass that check before either
  // commits — the `try`/`catch` around `save()` catches the resulting `23505` from the DB's own
  // unique constraint and turns it into the same 409 instead of letting it surface as a 500.
  async create(dto: CreateSkillDto): Promise<Skill> {
    const existing = await this.skillRepository.findOne({
      where: { name: dto.name },
    });
    if (existing) {
      throw new ConflictException(`A skill named "${dto.name}" already exists`);
    }

    const skill = this.skillRepository.create({
      name: dto.name,
      description: dto.description ?? null,
    });

    try {
      return await this.skillRepository.save(skill);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          `A skill named "${dto.name}" already exists`,
        );
      }
      throw error;
    }
  }

  findAll(): Promise<Skill[]> {
    return this.skillRepository.find({ order: { name: 'ASC' } });
  }
}
