import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Skill } from '../skills/entities/skill.entity';
import { CategoriesService } from './categories.service';
import { Category } from './entities/category.entity';

function buildSkill(overrides: Partial<Skill> = {}): Skill {
  const skill = new Skill();
  skill.id = 'skill-1';
  skill.name = 'Plomberie';
  skill.description = 'Fuites et tuyauterie.';
  Object.assign(skill, overrides);
  return skill;
}

function buildCategory(overrides: Partial<Category> = {}): Category {
  const category = new Category();
  category.id = 'cat-1';
  category.name = "Fuite d'eau";
  category.description = 'Fuite ou panne de plomberie.';
  category.requiredSkill = null;
  category.requiredSkillId = null;
  category.isActive = true;
  Object.assign(category, overrides);
  return category;
}

describe('CategoriesService', () => {
  let service: CategoriesService;
  let categoryRepository: {
    find: jest.Mock<Promise<Category[]>, [Record<string, unknown>]>;
    findOne: jest.Mock<Promise<Category | null>, [Record<string, unknown>]>;
    create: jest.Mock<Category, [Record<string, unknown>]>;
    save: jest.Mock<Promise<Category>, [Category]>;
  };
  let skillRepository: {
    existsBy: jest.Mock<Promise<boolean>, [Record<string, unknown>]>;
  };

  beforeEach(async () => {
    categoryRepository = {
      find: jest
        .fn<Promise<Category[]>, [Record<string, unknown>]>()
        .mockResolvedValue([]),
      findOne: jest
        .fn<Promise<Category | null>, [Record<string, unknown>]>()
        .mockResolvedValue(null),
      create: jest.fn<Category, [Record<string, unknown>]>(),
      save: jest.fn<Promise<Category>, [Category]>(),
    };
    skillRepository = {
      existsBy: jest
        .fn<Promise<boolean>, [Record<string, unknown>]>()
        .mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CategoriesService,
        { provide: getRepositoryToken(Category), useValue: categoryRepository },
        { provide: getRepositoryToken(Skill), useValue: skillRepository },
      ],
    }).compile();

    service = module.get(CategoriesService);
  });

  describe('findAll', () => {
    it('loads the requiredSkill relation in the same query and sorts by name ASC', async () => {
      await service.findAll({});

      expect(categoryRepository.find).toHaveBeenCalledWith({
        where: {},
        relations: { requiredSkill: true },
        order: { name: 'ASC' },
      });
    });

    it('passes isActive=false through instead of dropping it as falsy', async () => {
      await service.findAll({ isActive: false });

      expect(categoryRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isActive: false } }),
      );
    });

    it('nests the required skill, and reports null (not undefined) when there is none', async () => {
      categoryRepository.find.mockResolvedValue([
        buildCategory({
          requiredSkill: buildSkill(),
          requiredSkillId: 'skill-1',
        }),
        buildCategory({ id: 'cat-2', name: 'Autre' }),
      ]);

      const result = await service.findAll({});

      expect(result[0].requiredSkill).toEqual({
        id: 'skill-1',
        name: 'Plomberie',
        description: 'Fuites et tuyauterie.',
      });
      // Explicitly null, not absent: `undefined` would be dropped from the JSON body and the
      // key would vanish from the response.
      expect(result[1].requiredSkill).toBeNull();
      expect('requiredSkill' in result[1]).toBe(true);
    });

    it('never exposes createdAt/updatedAt', async () => {
      const category = buildCategory();
      category.createdAt = new Date();
      category.updatedAt = new Date();
      categoryRepository.find.mockResolvedValue([category]);

      const result = await service.findAll({});

      expect(Object.keys(result[0]).sort()).toEqual(
        ['description', 'id', 'isActive', 'name', 'requiredSkill'].sort(),
      );
    });
  });

  describe('create', () => {
    it('404s on an unknown requiredSkillId, and writes nothing', async () => {
      skillRepository.existsBy.mockResolvedValue(false);

      await expect(
        service.create({ name: 'Nouvelle', requiredSkillId: 'ghost-skill' }),
      ).rejects.toThrow(NotFoundException);
      expect(categoryRepository.save).not.toHaveBeenCalled();
    });

    it('409s on a duplicate name, and writes nothing', async () => {
      categoryRepository.findOne.mockResolvedValue(buildCategory());

      await expect(service.create({ name: "Fuite d'eau" })).rejects.toThrow(
        ConflictException,
      );
      expect(categoryRepository.save).not.toHaveBeenCalled();
    });

    it('translates a concurrent 23505 into a 409', async () => {
      categoryRepository.create.mockReturnValue(buildCategory());
      categoryRepository.save.mockRejectedValue({ code: '23505' });

      await expect(service.create({ name: 'Nouvelle' })).rejects.toThrow(
        ConflictException,
      );
    });

    it('rethrows an unrelated repository error untouched', async () => {
      const boom = new Error('connection lost');
      categoryRepository.create.mockReturnValue(buildCategory());
      categoryRepository.save.mockRejectedValue(boom);

      await expect(service.create({ name: 'Nouvelle' })).rejects.toThrow(boom);
    });

    it('normalises an absent description and requiredSkillId to null', async () => {
      const created = buildCategory();
      categoryRepository.create.mockReturnValue(created);
      categoryRepository.save.mockResolvedValue(created);
      categoryRepository.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValue(created);

      await service.create({ name: 'Nouvelle' });

      expect(categoryRepository.create).toHaveBeenCalledWith({
        name: 'Nouvelle',
        description: null,
        requiredSkillId: null,
      });
    });

    it('re-reads the row so the response carries the nested skill, not just its id', async () => {
      const saved = buildCategory({ requiredSkillId: 'skill-1' });
      const reloaded = buildCategory({
        requiredSkillId: 'skill-1',
        requiredSkill: buildSkill(),
      });
      categoryRepository.create.mockReturnValue(saved);
      categoryRepository.save.mockResolvedValue(saved);
      // 1st findOne: the duplicate-name pre-check. 2nd: the reload through `getById`.
      categoryRepository.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValue(reloaded);

      const result = await service.create({
        name: 'Nouvelle',
        requiredSkillId: 'skill-1',
      });

      expect(result.requiredSkill?.name).toBe('Plomberie');
    });
  });

  describe('update', () => {
    it('rejects an empty patch with 400, without loading anything', async () => {
      await expect(service.update('cat-1', {})).rejects.toThrow(
        BadRequestException,
      );
      expect(categoryRepository.findOne).not.toHaveBeenCalled();
    });

    it('404s on an unknown category', async () => {
      categoryRepository.findOne.mockResolvedValue(null);

      await expect(
        service.update('missing', { isActive: false }),
      ).rejects.toThrow(NotFoundException);
    });

    it('retires a category by setting isActive false — there is no delete path (D6)', async () => {
      const category = buildCategory();
      categoryRepository.findOne.mockResolvedValue(category);
      categoryRepository.save.mockResolvedValue(category);

      const result = await service.update('cat-1', { isActive: false });

      expect(category.isActive).toBe(false);
      expect(result.isActive).toBe(false);
      expect(service).not.toHaveProperty('delete');
      expect(service).not.toHaveProperty('remove');
    });

    it('clears the required skill when requiredSkillId is explicitly null, without validating it', async () => {
      const category = buildCategory({
        requiredSkillId: 'skill-1',
        requiredSkill: buildSkill(),
      });
      categoryRepository.findOne.mockResolvedValue(category);
      categoryRepository.save.mockResolvedValue(category);

      await service.update('cat-1', { requiredSkillId: null });

      expect(skillRepository.existsBy).not.toHaveBeenCalled();
      expect(category.requiredSkillId).toBeNull();
      // Cleared alongside the id: a stale relation object would make the response report the
      // OLD skill even though the column now says null.
      expect(category.requiredSkill).toBeNull();
    });

    it('drops the stale relation when the required skill is replaced', async () => {
      const category = buildCategory({
        requiredSkillId: 'skill-1',
        requiredSkill: buildSkill(),
      });
      categoryRepository.findOne.mockResolvedValue(category);
      categoryRepository.save.mockResolvedValue(category);

      await service.update('cat-1', { requiredSkillId: 'skill-2' });

      expect(category.requiredSkillId).toBe('skill-2');
      expect(category.requiredSkill).toBeNull();
    });

    it('404s on an unknown replacement skill, and writes nothing', async () => {
      categoryRepository.findOne.mockResolvedValue(buildCategory());
      skillRepository.existsBy.mockResolvedValue(false);

      await expect(
        service.update('cat-1', { requiredSkillId: 'ghost-skill' }),
      ).rejects.toThrow(NotFoundException);
      expect(categoryRepository.save).not.toHaveBeenCalled();
    });

    it('does not raise a conflict when the patch repeats the category own current name', async () => {
      const category = buildCategory();
      categoryRepository.findOne.mockResolvedValue(category);
      categoryRepository.save.mockResolvedValue(category);

      await service.update('cat-1', { name: category.name });

      // Exactly one findOne — the load. The duplicate-name lookup never ran.
      expect(categoryRepository.findOne).toHaveBeenCalledTimes(2);
      expect(categoryRepository.save).toHaveBeenCalledTimes(1);
    });

    it('409s when renaming onto another category name, and writes nothing', async () => {
      categoryRepository.findOne
        .mockResolvedValueOnce(buildCategory())
        .mockResolvedValueOnce(buildCategory({ id: 'cat-2', name: 'Prise' }));

      await expect(service.update('cat-1', { name: 'Prise' })).rejects.toThrow(
        ConflictException,
      );
      expect(categoryRepository.save).not.toHaveBeenCalled();
    });
  });
});
