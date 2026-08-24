import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Skill } from '../skills/entities/skill.entity';
import { Category } from './entities/category.entity';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';

// `Skill` is registered because this module validates `requiredSkillId` against it directly.
// `SkillsModule` is deliberately NOT imported: only the repository is needed, and importing the
// module would drag in its controller's route registration for no reason.
//
// `CategoriesService` is not exported: `TicketsModule` reads categories through its own
// `Category` repository (registered there since P4) and must keep doing so — this module owns
// the referential's write side, not every read of it.
@Module({
  imports: [TypeOrmModule.forFeature([Category, Skill])],
  controllers: [CategoriesController],
  providers: [CategoriesService],
})
export class CategoriesModule {}
