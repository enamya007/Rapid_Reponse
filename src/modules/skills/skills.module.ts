import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Skill } from './entities/skill.entity';
import { SkillsController } from './skills.controller';
import { SkillsService } from './skills.service';

// `SkillsService` is exported: T5.1b (`TechniciansModule`, `docs/plan-P5-contracts.md` §6) will
// consume it (e.g. to validate `skillId`s when setting a technician's skill set).
@Module({
  imports: [TypeOrmModule.forFeature([Skill])],
  controllers: [SkillsController],
  providers: [SkillsService],
  exports: [SkillsService],
})
export class SkillsModule {}
