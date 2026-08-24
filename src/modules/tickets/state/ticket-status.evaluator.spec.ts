import { TicketStatus } from '../enums/ticket-status.enum';
import { UserRole } from '../../users/enums/user-role.enum';
import { evaluateTicketTransition } from './ticket-status.evaluator';
import { ticketStatusMachine } from './ticket-status.machine';
import type { TicketEvent, TransitionContext } from './ticket-status.types';

const ALL_STATUSES: TicketStatus[] = [
  TicketStatus.OPEN,
  TicketStatus.ASSIGNED,
  TicketStatus.IN_PROGRESS,
  TicketStatus.RESOLVED,
  TicketStatus.CLOSED,
  TicketStatus.CANCELLED,
];

const ALL_EVENTS: TicketEvent[] = [
  'ASSIGN',
  'START',
  'RESOLVE',
  'REOPEN',
  'CLOSE',
  'CANCEL',
];

const TERMINAL_STATUSES: TicketStatus[] = [
  TicketStatus.CLOSED,
  TicketStatus.CANCELLED,
];

/** Least-privileged context: every flag off, actor is a plain CLIENT. */
function buildContext(
  overrides: Partial<TransitionContext> = {},
): TransitionContext {
  return {
    actorRole: UserRole.CLIENT,
    isActorAssignedTechnician: false,
    isActorOwnerClient: false,
    isTargetTechnicianActiveAndAvailable: false,
    hasResolutionNote: false,
    hasReason: false,
    ...overrides,
  };
}

describe('evaluateTicketTransition', () => {
  describe('valid transitions (guard satisfied)', () => {
    it('OPEN + ASSIGN -> ASSIGNED (admin assigning an active/available technician)', () => {
      const result = evaluateTicketTransition(
        TicketStatus.OPEN,
        'ASSIGN',
        buildContext({
          actorRole: UserRole.ADMIN,
          isTargetTechnicianActiveAndAvailable: true,
        }),
      );
      expect(result).toEqual({
        allowed: true,
        nextStatus: TicketStatus.ASSIGNED,
      });
    });

    it('ASSIGNED + ASSIGN -> ASSIGNED (admin reassigning with a reason)', () => {
      const result = evaluateTicketTransition(
        TicketStatus.ASSIGNED,
        'ASSIGN',
        buildContext({ actorRole: UserRole.ADMIN, hasReason: true }),
      );
      expect(result).toEqual({
        allowed: true,
        nextStatus: TicketStatus.ASSIGNED,
      });
    });

    it('ASSIGNED + START -> IN_PROGRESS (the assigned technician starts it)', () => {
      const result = evaluateTicketTransition(
        TicketStatus.ASSIGNED,
        'START',
        buildContext({
          actorRole: UserRole.TECHNICIAN,
          isActorAssignedTechnician: true,
        }),
      );
      expect(result).toEqual({
        allowed: true,
        nextStatus: TicketStatus.IN_PROGRESS,
      });
    });

    it('ASSIGNED + START -> IN_PROGRESS (admin, via the alternate OR-branch of the guard)', () => {
      const result = evaluateTicketTransition(
        TicketStatus.ASSIGNED,
        'START',
        buildContext({ actorRole: UserRole.ADMIN }),
      );
      expect(result).toEqual({
        allowed: true,
        nextStatus: TicketStatus.IN_PROGRESS,
      });
    });

    it('IN_PROGRESS + RESOLVE -> RESOLVED (assigned technician with a resolution note)', () => {
      const result = evaluateTicketTransition(
        TicketStatus.IN_PROGRESS,
        'RESOLVE',
        buildContext({
          actorRole: UserRole.TECHNICIAN,
          isActorAssignedTechnician: true,
          hasResolutionNote: true,
        }),
      );
      expect(result).toEqual({
        allowed: true,
        nextStatus: TicketStatus.RESOLVED,
      });
    });

    it('RESOLVED + REOPEN -> IN_PROGRESS (owner client with a reason)', () => {
      const result = evaluateTicketTransition(
        TicketStatus.RESOLVED,
        'REOPEN',
        buildContext({
          actorRole: UserRole.CLIENT,
          isActorOwnerClient: true,
          hasReason: true,
        }),
      );
      expect(result).toEqual({
        allowed: true,
        nextStatus: TicketStatus.IN_PROGRESS,
      });
    });

    it('RESOLVED + CLOSE -> CLOSED (admin)', () => {
      const result = evaluateTicketTransition(
        TicketStatus.RESOLVED,
        'CLOSE',
        buildContext({ actorRole: UserRole.ADMIN }),
      );
      expect(result).toEqual({
        allowed: true,
        nextStatus: TicketStatus.CLOSED,
      });
    });

    it('OPEN + CANCEL -> CANCELLED (owner client)', () => {
      const result = evaluateTicketTransition(
        TicketStatus.OPEN,
        'CANCEL',
        buildContext({ actorRole: UserRole.CLIENT, isActorOwnerClient: true }),
      );
      expect(result).toEqual({
        allowed: true,
        nextStatus: TicketStatus.CANCELLED,
      });
    });

    it('ASSIGNED + CANCEL -> CANCELLED (admin)', () => {
      const result = evaluateTicketTransition(
        TicketStatus.ASSIGNED,
        'CANCEL',
        buildContext({ actorRole: UserRole.ADMIN }),
      );
      expect(result).toEqual({
        allowed: true,
        nextStatus: TicketStatus.CANCELLED,
      });
    });

    it('IN_PROGRESS + CANCEL -> CANCELLED (admin)', () => {
      const result = evaluateTicketTransition(
        TicketStatus.IN_PROGRESS,
        'CANCEL',
        buildContext({ actorRole: UserRole.ADMIN }),
      );
      expect(result).toEqual({
        allowed: true,
        nextStatus: TicketStatus.CANCELLED,
      });
    });
  });

  describe('guard failures (event defined for the state, but context rejects it)', () => {
    it('OPEN + ASSIGN by a non-admin -> GUARD_FAILED', () => {
      const result = evaluateTicketTransition(
        TicketStatus.OPEN,
        'ASSIGN',
        buildContext({
          actorRole: UserRole.TECHNICIAN,
          isTargetTechnicianActiveAndAvailable: true,
        }),
      );
      expect(result).toEqual({ allowed: false, reason: 'GUARD_FAILED' });
    });

    it('OPEN + ASSIGN by an admin but the target technician is unavailable -> GUARD_FAILED', () => {
      const result = evaluateTicketTransition(
        TicketStatus.OPEN,
        'ASSIGN',
        buildContext({
          actorRole: UserRole.ADMIN,
          isTargetTechnicianActiveAndAvailable: false,
        }),
      );
      expect(result).toEqual({ allowed: false, reason: 'GUARD_FAILED' });
    });

    it('ASSIGNED + ASSIGN (reassignment) without a reason -> GUARD_FAILED', () => {
      const result = evaluateTicketTransition(
        TicketStatus.ASSIGNED,
        'ASSIGN',
        buildContext({ actorRole: UserRole.ADMIN, hasReason: false }),
      );
      expect(result).toEqual({ allowed: false, reason: 'GUARD_FAILED' });
    });

    it('ASSIGNED + START by a technician who is NOT the assigned one -> GUARD_FAILED', () => {
      const result = evaluateTicketTransition(
        TicketStatus.ASSIGNED,
        'START',
        buildContext({
          actorRole: UserRole.TECHNICIAN,
          isActorAssignedTechnician: false,
        }),
      );
      expect(result).toEqual({ allowed: false, reason: 'GUARD_FAILED' });
    });

    it('IN_PROGRESS + RESOLVE without a resolution note -> GUARD_FAILED', () => {
      const result = evaluateTicketTransition(
        TicketStatus.IN_PROGRESS,
        'RESOLVE',
        buildContext({
          actorRole: UserRole.TECHNICIAN,
          isActorAssignedTechnician: true,
          hasResolutionNote: false,
        }),
      );
      expect(result).toEqual({ allowed: false, reason: 'GUARD_FAILED' });
    });

    it('IN_PROGRESS + RESOLVE by an admin (not a technician) -> GUARD_FAILED', () => {
      const result = evaluateTicketTransition(
        TicketStatus.IN_PROGRESS,
        'RESOLVE',
        buildContext({ actorRole: UserRole.ADMIN, hasResolutionNote: true }),
      );
      expect(result).toEqual({ allowed: false, reason: 'GUARD_FAILED' });
    });

    it('RESOLVED + REOPEN by the owner client but without a reason -> GUARD_FAILED', () => {
      const result = evaluateTicketTransition(
        TicketStatus.RESOLVED,
        'REOPEN',
        buildContext({
          actorRole: UserRole.CLIENT,
          isActorOwnerClient: true,
          hasReason: false,
        }),
      );
      expect(result).toEqual({ allowed: false, reason: 'GUARD_FAILED' });
    });

    it('RESOLVED + REOPEN by a client who does NOT own the ticket -> GUARD_FAILED', () => {
      const result = evaluateTicketTransition(
        TicketStatus.RESOLVED,
        'REOPEN',
        buildContext({
          actorRole: UserRole.CLIENT,
          isActorOwnerClient: false,
          hasReason: true,
        }),
      );
      expect(result).toEqual({ allowed: false, reason: 'GUARD_FAILED' });
    });

    it('RESOLVED + CLOSE by a client who does NOT own the ticket -> GUARD_FAILED', () => {
      const result = evaluateTicketTransition(
        TicketStatus.RESOLVED,
        'CLOSE',
        buildContext({ actorRole: UserRole.CLIENT, isActorOwnerClient: false }),
      );
      expect(result).toEqual({ allowed: false, reason: 'GUARD_FAILED' });
    });

    it('ASSIGNED + CANCEL by the owner client -> GUARD_FAILED (client can only cancel from OPEN)', () => {
      const result = evaluateTicketTransition(
        TicketStatus.ASSIGNED,
        'CANCEL',
        buildContext({ actorRole: UserRole.CLIENT, isActorOwnerClient: true }),
      );
      expect(result).toEqual({ allowed: false, reason: 'GUARD_FAILED' });
    });
  });

  describe('structurally invalid transitions (event not defined for the state)', () => {
    it.each<[TicketStatus, TicketEvent]>([
      [TicketStatus.OPEN, 'START'],
      [TicketStatus.OPEN, 'RESOLVE'],
      [TicketStatus.IN_PROGRESS, 'ASSIGN'],
      [TicketStatus.RESOLVED, 'START'],
    ])(
      '%s + %s -> INVALID_TRANSITION, regardless of context',
      (status, event) => {
        // An all-privileges context: proves the rejection is structural, not a
        // guard failure -- even a maximally-privileged actor cannot pass.
        const result = evaluateTicketTransition(
          status,
          event,
          buildContext({
            actorRole: UserRole.ADMIN,
            isActorAssignedTechnician: true,
            isActorOwnerClient: true,
            isTargetTechnicianActiveAndAvailable: true,
            hasResolutionNote: true,
            hasReason: true,
          }),
        );
        expect(result).toEqual({
          allowed: false,
          reason: 'INVALID_TRANSITION',
        });
      },
    );
  });

  describe('terminal states reject every event', () => {
    it.each(TERMINAL_STATUSES)(
      '%s rejects all 6 events with INVALID_TRANSITION',
      (status) => {
        for (const event of ALL_EVENTS) {
          const result = evaluateTicketTransition(
            status,
            event,
            buildContext({
              actorRole: UserRole.ADMIN,
              isActorAssignedTechnician: true,
              isActorOwnerClient: true,
              isTargetTechnicianActiveAndAvailable: true,
              hasResolutionNote: true,
              hasReason: true,
            }),
          );
          expect(result).toEqual({
            allowed: false,
            reason: 'INVALID_TRANSITION',
          });
        }
      },
    );

    // Rejecting all 6 events (checked above) only proves nothing is wired
    // under `on:` for these states -- it would stay true even if `type:
    // 'final'` were dropped from the machine config. This assertion targets
    // the `final` marking itself, at the machine/snapshot level.
    it.each(TERMINAL_STATUSES)(
      '%s is modeled as an XState final state (snapshot status is "done")',
      (status) => {
        const snapshot = ticketStatusMachine.resolveState({
          value: status,
          context: buildContext(),
        });
        expect(snapshot.status).toBe('done');
      },
    );
  });

  describe('shape invariant, swept over the entire 6x6 (status x event) grid', () => {
    const maximalPrivilegeContext = buildContext({
      actorRole: UserRole.ADMIN,
      isActorAssignedTechnician: true,
      isActorOwnerClient: true,
      isTargetTechnicianActiveAndAvailable: true,
      hasResolutionNote: true,
      hasReason: true,
    });
    const minimalPrivilegeContext = buildContext();

    const contexts: Array<[string, TransitionContext]> = [
      ['maximal-privilege context', maximalPrivilegeContext],
      ['minimal-privilege context', minimalPrivilegeContext],
    ];

    for (const [contextLabel, context] of contexts) {
      describe(contextLabel, () => {
        for (const status of ALL_STATUSES) {
          for (const event of ALL_EVENTS) {
            it(`${status} + ${event}: allowed <=> nextStatus set <=> reason absent`, () => {
              const result = evaluateTicketTransition(status, event, context);

              if (result.allowed) {
                expect(result.nextStatus).toBeDefined();
                expect(Object.values(TicketStatus)).toContain(
                  result.nextStatus,
                );
                expect(result.reason).toBeUndefined();
              } else {
                expect(result.reason).toBeDefined();
                expect(['INVALID_TRANSITION', 'GUARD_FAILED']).toContain(
                  result.reason,
                );
                expect(result.nextStatus).toBeUndefined();
              }
            });
          }
        }
      });
    }
  });
});
