import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CreateSkillDto } from './dto/create-skill.dto';
import { SkillResponseDto } from './dto/skill-response.dto';
import { Skill } from './entities/skill.entity';
import { SkillsService } from './skills.service';

function buildSkill(overrides: Partial<Skill> = {}): Skill {
  const skill = new Skill();
  skill.id = 'skill-1';
  skill.name = 'Plomberie';
  skill.description = null;
  skill.createdAt = new Date('2026-08-06T10:00:00.000Z');
  skill.updatedAt = new Date('2026-08-06T10:00:00.000Z');
  Object.assign(skill, overrides);
  return skill;
}

describe('SkillsService', () => {
  let service: SkillsService;
  let skillRepository: {
    findOne: jest.Mock<Promise<Skill | null>, [Record<string, unknown>]>;
    create: jest.Mock<Skill, [Record<string, unknown>]>;
    save: jest.Mock<Promise<Skill>, [Skill]>;
    find: jest.Mock<Promise<Skill[]>, [Record<string, unknown>?]>;
  };

  beforeEach(async () => {
    skillRepository = {
      findOne: jest.fn<Promise<Skill | null>, [Record<string, unknown>]>(),
      create: jest.fn<Skill, [Record<string, unknown>]>(),
      save: jest.fn<Promise<Skill>, [Skill]>(),
      find: jest.fn<Promise<Skill[]>, [Record<string, unknown>?]>(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SkillsService,
        {
          provide: getRepositoryToken(Skill),
          useValue: skillRepository,
        },
      ],
    }).compile();

    service = module.get(SkillsService);
  });

  describe('create', () => {
    it('creates a skill when the name is not already taken, and returns the saved entity', async () => {
      const dto: CreateSkillDto = {
        name: 'Plomberie',
        description: 'Fuites, tuyauterie, sanitaires.',
      };
      skillRepository.findOne.mockResolvedValue(null);
      const createdEntity = buildSkill({ description: dto.description });
      skillRepository.create.mockReturnValue(createdEntity);
      skillRepository.save.mockResolvedValue(createdEntity);

      const result = await service.create(dto);

      expect(skillRepository.findOne).toHaveBeenCalledWith({
        where: { name: 'Plomberie' },
      });
      expect(skillRepository.create).toHaveBeenCalledWith({
        name: 'Plomberie',
        description: dto.description,
      });
      expect(skillRepository.save).toHaveBeenCalledWith(createdEntity);
      expect(result).toBe(createdEntity);
    });

    it('defaults description to null when omitted from the DTO', async () => {
      const dto: CreateSkillDto = { name: 'Serrurerie' };
      skillRepository.findOne.mockResolvedValue(null);
      const createdEntity = buildSkill({
        name: 'Serrurerie',
        description: null,
      });
      skillRepository.create.mockReturnValue(createdEntity);
      skillRepository.save.mockResolvedValue(createdEntity);

      await service.create(dto);

      expect(skillRepository.create).toHaveBeenCalledWith({
        name: 'Serrurerie',
        description: null,
      });
    });

    it('rejects with a 409 ConflictException when a skill with the same name is found by the pre-check, and never calls create/save', async () => {
      const dto: CreateSkillDto = { name: 'Plomberie' };
      skillRepository.findOne.mockResolvedValue(
        buildSkill({ name: 'Plomberie' }),
      );

      await expect(service.create(dto)).rejects.toThrow(ConflictException);

      expect(skillRepository.create).not.toHaveBeenCalled();
      expect(skillRepository.save).not.toHaveBeenCalled();
    });

    it('rejects with a 409 ConflictException (not a raw 500) when `save` rejects with SQLSTATE 23505, even though the pre-check found nothing (race between two concurrent inserts)', async () => {
      const dto: CreateSkillDto = { name: 'Plomberie' };
      skillRepository.findOne.mockResolvedValue(null);
      const createdEntity = buildSkill({ name: 'Plomberie' });
      skillRepository.create.mockReturnValue(createdEntity);
      skillRepository.save.mockRejectedValue({ code: '23505' });

      await expect(service.create(dto)).rejects.toThrow(ConflictException);
    });

    it('propagates any other `save` error unchanged, rather than swallowing it as a 409', async () => {
      const dto: CreateSkillDto = { name: 'Plomberie' };
      skillRepository.findOne.mockResolvedValue(null);
      const createdEntity = buildSkill({ name: 'Plomberie' });
      skillRepository.create.mockReturnValue(createdEntity);
      const dbError = new Error('connection lost');
      skillRepository.save.mockRejectedValue(dbError);

      await expect(service.create(dto)).rejects.toThrow('connection lost');
    });
  });

  describe('findAll', () => {
    it('returns every skill ordered by name ASC (delegated to the repository, not sorted in memory)', async () => {
      const skills = [buildSkill({ id: 's-1', name: 'Informatique' })];
      skillRepository.find.mockResolvedValue(skills);

      const result = await service.findAll();

      expect(skillRepository.find).toHaveBeenCalledWith({
        order: { name: 'ASC' },
      });
      expect(result).toBe(skills);
    });
  });

  describe('SkillResponseDto shape', () => {
    it('exposes exactly id, name, description — nothing else (no createdAt/updatedAt leak)', () => {
      const skill = buildSkill();

      const dto = SkillResponseDto.fromEntity(skill);

      expect(Object.keys(dto).sort()).toEqual(
        ['description', 'id', 'name'].sort(),
      );
      expect(dto.id).toBe(skill.id);
      expect(dto.name).toBe(skill.name);
      expect(dto.description).toBe(skill.description);
    });
  });
});
