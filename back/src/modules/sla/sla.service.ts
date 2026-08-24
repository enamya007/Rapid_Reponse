import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TicketPriority } from '../tickets/enums/ticket-priority.enum';
import { SlaPolicyResponseDto } from './dto/sla-policy-response.dto';
import { UpsertSlaPolicyDto } from './dto/upsert-sla-policy.dto';
import { SlaPolicy } from './entities/sla-policy.entity';

// Business severity, most urgent first — NOT the enum's declaration order (which starts at LOW)
// and not alphabetical (which would read CRITICAL, HIGH, LOW, NORMAL and put LOW above NORMAL).
// Sorting happens in JS rather than SQL because ordering a PostgreSQL enum column yields its
// declaration order, which is the wrong one here.
const PRIORITY_SEVERITY_ORDER: TicketPriority[] = [
  TicketPriority.CRITICAL,
  TicketPriority.HIGH,
  TicketPriority.NORMAL,
  TicketPriority.LOW,
];

// P6.5 contract §3 (`docs/plan-P6.5-contracts.md`) — figée. Makes the `sla_policies` table
// actually configurable, which D6 of `plan-backend.md` promised ("configurable, pas de constante
// en dur") but no route delivered: the table was seeded and read, never written.
@Injectable()
export class SlaService {
  constructor(
    @InjectRepository(SlaPolicy)
    private readonly slaPolicyRepository: Repository<SlaPolicy>,
  ) {}

  // `GET /sla-policies` — returns whatever rows exist, ordered by severity. A priority with no
  // configured row is simply absent (that is the state `TicketsService.resolveSlaDueAt` logs a
  // warning for), not fabricated with a default that no table row backs.
  async findAll(): Promise<SlaPolicyResponseDto[]> {
    const policies = await this.slaPolicyRepository.find();

    return policies
      .sort(
        (a, b) =>
          PRIORITY_SEVERITY_ORDER.indexOf(a.priority) -
          PRIORITY_SEVERITY_ORDER.indexOf(b.priority),
      )
      .map((policy) => SlaPolicyResponseDto.fromEntity(policy));
  }

  // `PUT /sla-policies/:priority` — upsert (D8). Creating on absence is what removes the
  // "no SLA policy configured for priority X" hole for good: an admin can fill it through the
  // API instead of having to re-run the seed.
  //
  // The change applies to tickets created AFTER it: `Ticket.slaDueAt` is materialized once, at
  // creation. Recomputing it for tickets already open would retroactively move deadlines that
  // have already been communicated and, in P7, already measured.
  async upsert(
    priority: TicketPriority,
    dto: UpsertSlaPolicyDto,
  ): Promise<SlaPolicyResponseDto> {
    const existing = await this.slaPolicyRepository.findOneBy({ priority });

    const policy =
      existing ??
      this.slaPolicyRepository.create({
        priority,
        resolutionTargetMinutes: dto.resolutionTargetMinutes,
      });
    policy.resolutionTargetMinutes = dto.resolutionTargetMinutes;

    const saved = await this.slaPolicyRepository.save(policy);
    return SlaPolicyResponseDto.fromEntity(saved);
  }
}
