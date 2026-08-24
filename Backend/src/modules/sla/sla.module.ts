import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SlaPolicy } from './entities/sla-policy.entity';
import { SlaController } from './sla.controller';
import { SlaService } from './sla.service';

// `SlaService` is not exported: `TicketsModule` computes `slaDueAt` through its own `SlaPolicy`
// repository (registered there since P4). This module owns the write side of the referential,
// and adding a second read path through it would blur where the calculation lives.
@Module({
  imports: [TypeOrmModule.forFeature([SlaPolicy])],
  controllers: [SlaController],
  providers: [SlaService],
})
export class SlaModule {}
