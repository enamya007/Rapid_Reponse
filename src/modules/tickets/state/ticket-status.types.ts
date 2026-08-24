import { TicketStatus } from '../enums/ticket-status.enum';
import { UserRole } from '../../users/enums/user-role.enum';

/**
 * Ticket lifecycle events accepted by the ticket status state machine
 * (`ticket-status.machine.ts`). This is the exhaustive event vocabulary
 * described in plan-backend.md §3 -- nothing more, nothing less.
 */
export type TicketEvent =
  'ASSIGN' | 'START' | 'RESOLVE' | 'REOPEN' | 'CLOSE' | 'CANCEL';

/**
 * Everything the machine's guards need to know about the actor performing
 * the transition and the ticket it applies to. The service layer builds
 * this from the authenticated user and the ticket/assignment rows it has
 * already loaded; the machine and its guards never read the database
 * themselves.
 */
export interface TransitionContext {
  /** Role of the user attempting the transition. */
  actorRole: UserRole;
  /** Whether the actor is THE technician currently assigned to the ticket. */
  isActorAssignedTechnician: boolean;
  /** Whether the actor is the CLIENT who owns (created) the ticket. */
  isActorOwnerClient: boolean;
  /** For `ASSIGN` from `OPEN`: whether the target technician is active and available. */
  isTargetTechnicianActiveAndAvailable: boolean;
  /** For `RESOLVE`: whether a non-empty resolution note was supplied. */
  hasResolutionNote: boolean;
  /** For a reassignment `ASSIGN` or for `REOPEN`: whether a reason/motive was supplied. */
  hasReason: boolean;
}

/** Why a requested transition was rejected. */
export type TransitionRejectionReason = 'INVALID_TRANSITION' | 'GUARD_FAILED';

/**
 * Outcome of evaluating a transition against the ticket status machine.
 *
 * Invariant: `allowed === true` if and only if `nextStatus` is set and
 * `reason` is absent; `allowed === false` if and only if `reason` is set
 * and `nextStatus` is absent.
 */
export interface TransitionResult {
  allowed: boolean;
  /** Defined if and only if `allowed === true`. */
  nextStatus?: TicketStatus;
  /** Defined if and only if `allowed === false`. */
  reason?: TransitionRejectionReason;
}
