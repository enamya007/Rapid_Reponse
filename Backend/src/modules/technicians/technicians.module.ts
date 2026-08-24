import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Skill } from '../skills/entities/skill.entity';
import { Ticket } from '../tickets/entities/ticket.entity';
import { User } from '../users/entities/user.entity';
import { UsersModule } from '../users/users.module';
import { TechnicianProfile } from './entities/technician-profile.entity';
import { TechnicianSkill } from './entities/technician-skill.entity';
import { TechnicianSuggestionService } from './technician-suggestion.service';
import { TechniciansController } from './technicians.controller';
import { TechniciansService } from './technicians.service';

// P5 contract §6 (`docs/plan-P5-contracts.md`) — figée. `forFeature` is adjusted to what this
// module actually queries directly: `Category` is deliberately ABSENT — the only place that
// would need it (`TechnicianSuggestionService.suggestForTicket` reading
// `ticket.category.requiredSkillId`) reaches it through `Ticket`'s own `relations: { category:
// true }`, which resolves via TypeORM's global entity metadata and needs no repository of its
// own registered in this module.
//
// `TechniciansService`/`TechnicianSuggestionService` are both exported: T5.3 (affectation) will
// consume the latter for eligibility (§4.1) and suggestion (§4.3).
@Module({
  imports: [
    TypeOrmModule.forFeature([
      TechnicianProfile,
      TechnicianSkill,
      Skill,
      User,
      Ticket,
    ]),
    UsersModule,
  ],
  controllers: [TechniciansController],
  providers: [TechniciansService, TechnicianSuggestionService],
  exports: [TechniciansService, TechnicianSuggestionService],
})
export class TechniciansModule {}
