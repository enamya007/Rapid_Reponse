import { setup } from 'xstate';
import { TicketStatus } from '../enums/ticket-status.enum';
import { UserRole } from '../../users/enums/user-role.enum';
import type { TicketEvent, TransitionContext } from './ticket-status.types';

/**
 * XState event object wrapping the domain-level `TicketEvent` union. XState
 * requires every event object to carry a `type` discriminant.
 */
export interface TicketStatusMachineEvent {
  type: TicketEvent;
}

/**
 * Neutral, least-privileged context used only as the machine's declared
 * initial context (relevant if the machine is ever interpreted as a
 * standalone actor for inspection/visualisation, e.g. by the Next.js
 * frontend or the Stately inspector). `evaluateTicketTransition` never
 * relies on this default: it always builds a fresh snapshot, via
 * `resolveState`, from the real caller-supplied `TransitionContext`.
 */
const INITIAL_CONTEXT: TransitionContext = {
  actorRole: UserRole.CLIENT,
  isActorAssignedTechnician: false,
  isActorOwnerClient: false,
  isTargetTechnicianActiveAndAvailable: false,
  hasResolutionNote: false,
  hasReason: false,
};

/**
 * Pure, descriptive XState v5 machine encoding the ticket lifecycle
 * (plan-backend.md §3).
 *
 * It has no invoked/spawned actors, no `assign` writing back to a data
 * store and no side-effecting `entry`/`exit` actions: it only describes
 * which events are structurally valid from which state, and the
 * role/context guards that gate each transition. The `status` column on
 * the `Ticket` entity remains the single source of truth -- this machine is
 * never interpreted or persisted by the service layer, it is only
 * evaluated (see `evaluateTicketTransition`). It is exported as-is so it
 * can be reused unmodified by the Next.js frontend (e.g. to drive a status
 * timeline or to enable/disable action buttons for the current user).
 */
export const ticketStatusMachine = setup({
  types: {
    context: {} as TransitionContext,
    events: {} as TicketStatusMachineEvent,
  },
  guards: {
    canAssignFromOpen: ({ context }) =>
      context.actorRole === UserRole.ADMIN &&
      context.isTargetTechnicianActiveAndAvailable,
    canReassignFromAssigned: ({ context }) =>
      context.actorRole === UserRole.ADMIN && context.hasReason,
    canStartFromAssigned: ({ context }) =>
      (context.actorRole === UserRole.TECHNICIAN &&
        context.isActorAssignedTechnician) ||
      context.actorRole === UserRole.ADMIN,
    canResolveFromInProgress: ({ context }) =>
      context.actorRole === UserRole.TECHNICIAN &&
      context.isActorAssignedTechnician &&
      context.hasResolutionNote,
    canReopenFromResolved: ({ context }) =>
      (context.isActorOwnerClient || context.actorRole === UserRole.ADMIN) &&
      context.hasReason,
    canCloseFromResolved: ({ context }) =>
      context.actorRole === UserRole.ADMIN || context.isActorOwnerClient,
    canCancelFromOpen: ({ context }) =>
      context.actorRole === UserRole.ADMIN || context.isActorOwnerClient,
    canCancelFromAssigned: ({ context }) =>
      context.actorRole === UserRole.ADMIN,
    canCancelFromInProgress: ({ context }) =>
      context.actorRole === UserRole.ADMIN,
  },
}).createMachine({
  id: 'ticketStatus',
  context: INITIAL_CONTEXT,
  initial: TicketStatus.OPEN,
  states: {
    [TicketStatus.OPEN]: {
      on: {
        ASSIGN: { target: TicketStatus.ASSIGNED, guard: 'canAssignFromOpen' },
        CANCEL: { target: TicketStatus.CANCELLED, guard: 'canCancelFromOpen' },
      },
    },
    [TicketStatus.ASSIGNED]: {
      on: {
        ASSIGN: {
          target: TicketStatus.ASSIGNED,
          guard: 'canReassignFromAssigned',
        },
        START: {
          target: TicketStatus.IN_PROGRESS,
          guard: 'canStartFromAssigned',
        },
        CANCEL: {
          target: TicketStatus.CANCELLED,
          guard: 'canCancelFromAssigned',
        },
      },
    },
    [TicketStatus.IN_PROGRESS]: {
      on: {
        RESOLVE: {
          target: TicketStatus.RESOLVED,
          guard: 'canResolveFromInProgress',
        },
        CANCEL: {
          target: TicketStatus.CANCELLED,
          guard: 'canCancelFromInProgress',
        },
      },
    },
    [TicketStatus.RESOLVED]: {
      on: {
        REOPEN: {
          target: TicketStatus.IN_PROGRESS,
          guard: 'canReopenFromResolved',
        },
        CLOSE: { target: TicketStatus.CLOSED, guard: 'canCloseFromResolved' },
      },
    },
    [TicketStatus.CLOSED]: {
      type: 'final',
    },
    [TicketStatus.CANCELLED]: {
      type: 'final',
    },
  },
});

export type TicketStatusMachine = typeof ticketStatusMachine;
