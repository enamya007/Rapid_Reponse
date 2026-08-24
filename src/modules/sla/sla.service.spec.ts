import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TicketPriority } from '../tickets/enums/ticket-priority.enum';
import { SlaPolicy } from './entities/sla-policy.entity';
import { SlaService } from './sla.service';

function buildPolicy(
  priority: TicketPriority,
  resolutionTargetMinutes: number,
): SlaPolicy {
  const policy = new SlaPolicy();
  policy.id = `policy-${priority}`;
  policy.priority = priority;
  policy.resolutionTargetMinutes = resolutionTargetMinutes;
  policy.createdAt = new Date('2024-01-01T00:00:00.000Z');
  policy.updatedAt = new Date('2024-01-02T00:00:00.000Z');
  return policy;
}

describe('SlaService', () => {
  let service: SlaService;
  let slaPolicyRepository: {
    find: jest.Mock<Promise<SlaPolicy[]>, []>;
    findOneBy: jest.Mock<Promise<SlaPolicy | null>, [Record<string, unknown>]>;
    create: jest.Mock<SlaPolicy, [Record<string, unknown>]>;
    save: jest.Mock<Promise<SlaPolicy>, [SlaPolicy]>;
  };

  beforeEach(async () => {
    slaPolicyRepository = {
      find: jest.fn<Promise<SlaPolicy[]>, []>().mockResolvedValue([]),
      findOneBy: jest
        .fn<Promise<SlaPolicy | null>, [Record<string, unknown>]>()
        .mockResolvedValue(null),
      create: jest.fn<SlaPolicy, [Record<string, unknown>]>(),
      save: jest.fn<Promise<SlaPolicy>, [SlaPolicy]>(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SlaService,
        {
          provide: getRepositoryToken(SlaPolicy),
          useValue: slaPolicyRepository,
        },
      ],
    }).compile();

    service = module.get(SlaService);
  });

  describe('findAll', () => {
    it('orders by business severity, not alphabetically and not by enum declaration order', async () => {
      // Returned deliberately scrambled so the assertion measures the sort, not the input.
      slaPolicyRepository.find.mockResolvedValue([
        buildPolicy(TicketPriority.NORMAL, 4320),
        buildPolicy(TicketPriority.LOW, 7200),
        buildPolicy(TicketPriority.CRITICAL, 240),
        buildPolicy(TicketPriority.HIGH, 1440),
      ]);

      const result = await service.findAll();

      expect(result.map((policy) => policy.priority)).toEqual([
        TicketPriority.CRITICAL,
        TicketPriority.HIGH,
        TicketPriority.NORMAL,
        TicketPriority.LOW,
      ]);
      // Alphabetical would place LOW before NORMAL; the enum's own order starts at LOW. Both
      // wrong orders are excluded by the exact sequence above.
    });

    it('returns only the rows that exist — a missing priority is absent, never defaulted', async () => {
      slaPolicyRepository.find.mockResolvedValue([
        buildPolicy(TicketPriority.CRITICAL, 240),
      ]);

      const result = await service.findAll();

      expect(result).toHaveLength(1);
      expect(result[0].priority).toBe(TicketPriority.CRITICAL);
    });

    it('exposes exactly priority, resolutionTargetMinutes and updatedAt — never the row id', async () => {
      slaPolicyRepository.find.mockResolvedValue([
        buildPolicy(TicketPriority.HIGH, 1440),
      ]);

      const result = await service.findAll();

      expect(Object.keys(result[0]).sort()).toEqual(
        ['priority', 'resolutionTargetMinutes', 'updatedAt'].sort(),
      );
    });
  });

  describe('upsert — D8', () => {
    it('updates the existing row in place when the priority already has a policy', async () => {
      const existing = buildPolicy(TicketPriority.CRITICAL, 240);
      slaPolicyRepository.findOneBy.mockResolvedValue(existing);
      slaPolicyRepository.save.mockImplementation((policy: SlaPolicy) =>
        Promise.resolve(policy),
      );

      const result = await service.upsert(TicketPriority.CRITICAL, {
        resolutionTargetMinutes: 120,
      });

      // The SAME row is saved: no second policy is created for a priority that has one, which
      // the DB's unique constraint on `priority` would reject anyway.
      expect(slaPolicyRepository.create).not.toHaveBeenCalled();
      expect(slaPolicyRepository.save).toHaveBeenCalledWith(existing);
      expect(result.resolutionTargetMinutes).toBe(120);
    });

    it('creates the row when the priority has none — this is what closes the "no SLA policy configured" hole', async () => {
      slaPolicyRepository.findOneBy.mockResolvedValue(null);
      const created = buildPolicy(TicketPriority.LOW, 7200);
      slaPolicyRepository.create.mockReturnValue(created);
      slaPolicyRepository.save.mockImplementation((policy: SlaPolicy) =>
        Promise.resolve(policy),
      );

      const result = await service.upsert(TicketPriority.LOW, {
        resolutionTargetMinutes: 5000,
      });

      expect(slaPolicyRepository.create).toHaveBeenCalledWith({
        priority: TicketPriority.LOW,
        resolutionTargetMinutes: 5000,
      });
      expect(result.resolutionTargetMinutes).toBe(5000);
    });

    it('keys the lookup on the priority from the route, never on a body field', async () => {
      slaPolicyRepository.findOneBy.mockResolvedValue(null);
      slaPolicyRepository.create.mockReturnValue(
        buildPolicy(TicketPriority.HIGH, 1440),
      );
      slaPolicyRepository.save.mockImplementation((policy: SlaPolicy) =>
        Promise.resolve(policy),
      );

      await service.upsert(TicketPriority.HIGH, {
        resolutionTargetMinutes: 60,
      });

      expect(slaPolicyRepository.findOneBy).toHaveBeenCalledWith({
        priority: TicketPriority.HIGH,
      });
    });

    it('touches no ticket: the new target applies to tickets created afterwards only (D8)', async () => {
      const existing = buildPolicy(TicketPriority.NORMAL, 4320);
      slaPolicyRepository.findOneBy.mockResolvedValue(existing);
      slaPolicyRepository.save.mockImplementation((policy: SlaPolicy) =>
        Promise.resolve(policy),
      );

      await service.upsert(TicketPriority.NORMAL, {
        resolutionTargetMinutes: 60,
      });

      // The service holds a single repository — `SlaPolicy`. It structurally cannot rewrite
      // `slaDueAt` on existing tickets, which is the guarantee D8 rests on.
      expect(Object.keys(service)).toEqual(['slaPolicyRepository']);
    });
  });
});
