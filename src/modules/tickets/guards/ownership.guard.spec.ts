import {
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { User } from '../../users/entities/user.entity';
import { UserRole } from '../../users/enums/user-role.enum';
import { Ticket } from '../entities/ticket.entity';
import { OwnershipGuard } from './ownership.guard';

function buildUser(overrides: Partial<User> = {}): User {
  const user = new User();
  user.id = 'user-1';
  user.username = 'jdoe';
  user.role = UserRole.CLIENT;
  Object.assign(user, overrides);
  return user;
}

function buildTicket(overrides: Partial<Ticket> = {}): Ticket {
  const ticket = new Ticket();
  ticket.id = 'ticket-1';
  ticket.createdById = 'owner-id';
  ticket.assigneeId = null;
  Object.assign(ticket, overrides);
  return ticket;
}

interface MutableRequest {
  params: { id?: string };
  user?: User;
  ticket?: Ticket;
}

function buildExecutionContext(request: MutableRequest): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

describe('OwnershipGuard', () => {
  let guard: OwnershipGuard;
  let ticketRepository: {
    findOneBy: jest.Mock<Promise<Ticket | null>, [Record<string, unknown>]>;
  };

  beforeEach(async () => {
    ticketRepository = {
      findOneBy: jest.fn<Promise<Ticket | null>, [Record<string, unknown>]>(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OwnershipGuard,
        { provide: getRepositoryToken(Ticket), useValue: ticketRepository },
      ],
    }).compile();

    guard = module.get(OwnershipGuard);
  });

  it('throws NotFoundException when the ticket does not exist', async () => {
    ticketRepository.findOneBy.mockResolvedValue(null);
    const request: MutableRequest = {
      params: { id: 'missing-id' },
      user: buildUser(),
    };

    await expect(
      guard.canActivate(buildExecutionContext(request)),
    ).rejects.toThrow(NotFoundException);
    expect(ticketRepository.findOneBy).toHaveBeenCalledWith({
      id: 'missing-id',
    });
    expect(request.ticket).toBeUndefined();
  });

  it('authorizes an ADMIN who is neither the owner nor the assignee, and attaches the ticket to the request', async () => {
    const ticket = buildTicket({
      createdById: 'someone-else',
      assigneeId: 'yet-another-person',
    });
    ticketRepository.findOneBy.mockResolvedValue(ticket);
    const admin = buildUser({ id: 'admin-1', role: UserRole.ADMIN });
    const request: MutableRequest = { params: { id: 'ticket-1' }, user: admin };

    const result = await guard.canActivate(buildExecutionContext(request));

    expect(result).toBe(true);
    expect(request.ticket).toBe(ticket);
  });

  it('authorizes the CLIENT who created the ticket (owner), and attaches the ticket to the request', async () => {
    const owner = buildUser({ id: 'client-1', role: UserRole.CLIENT });
    const ticket = buildTicket({ createdById: owner.id, assigneeId: null });
    ticketRepository.findOneBy.mockResolvedValue(ticket);
    const request: MutableRequest = { params: { id: 'ticket-1' }, user: owner };

    const result = await guard.canActivate(buildExecutionContext(request));

    expect(result).toBe(true);
    expect(request.ticket).toBe(ticket);
  });

  it('rejects a CLIENT who did not create the ticket with ForbiddenException', async () => {
    const ticket = buildTicket({
      createdById: 'someone-else',
      assigneeId: null,
    });
    ticketRepository.findOneBy.mockResolvedValue(ticket);
    const otherClient = buildUser({ id: 'client-2', role: UserRole.CLIENT });
    const request: MutableRequest = {
      params: { id: 'ticket-1' },
      user: otherClient,
    };

    await expect(
      guard.canActivate(buildExecutionContext(request)),
    ).rejects.toThrow(ForbiddenException);
    expect(request.ticket).toBeUndefined();
  });

  it('authorizes the TECHNICIAN assigned to the ticket, and attaches the ticket to the request', async () => {
    const technician = buildUser({
      id: 'tech-1',
      role: UserRole.TECHNICIAN,
    });
    const ticket = buildTicket({
      createdById: 'client-1',
      assigneeId: technician.id,
    });
    ticketRepository.findOneBy.mockResolvedValue(ticket);
    const request: MutableRequest = {
      params: { id: 'ticket-1' },
      user: technician,
    };

    const result = await guard.canActivate(buildExecutionContext(request));

    expect(result).toBe(true);
    expect(request.ticket).toBe(ticket);
  });

  it('rejects a TECHNICIAN who is not assigned to the ticket with ForbiddenException', async () => {
    const ticket = buildTicket({
      createdById: 'client-1',
      assigneeId: 'other-technician-id',
    });
    ticketRepository.findOneBy.mockResolvedValue(ticket);
    const unassignedTechnician = buildUser({
      id: 'tech-2',
      role: UserRole.TECHNICIAN,
    });
    const request: MutableRequest = {
      params: { id: 'ticket-1' },
      user: unassignedTechnician,
    };

    await expect(
      guard.canActivate(buildExecutionContext(request)),
    ).rejects.toThrow(ForbiddenException);
    expect(request.ticket).toBeUndefined();
  });
});
