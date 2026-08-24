import { getNextTransitions, transition } from 'xstate';
import { TicketStatus } from '../enums/ticket-status.enum';
import {
  ticketStatusMachine,
  TicketStatusMachineEvent,
} from './ticket-status.machine';
import type {
  TicketEvent,
  TransitionContext,
  TransitionResult,
} from './ticket-status.types';

/**
 * Pure evaluation of a single ticket lifecycle transition against
 * `ticketStatusMachine`. No I/O, no side effects, no DB reads: `current`
 * and `ctx` must already reflect the ticket/actor state the caller (the
 * tickets service) loaded beforehand.
 *
 * XState's own guarded-transition resolution cannot, by itself, tell an
 * unhandled event apart from a handled event whose guard failed -- both
 * simply resolve to "no transition happens" from the same snapshot. The two
 * cases are therefore checked explicitly, in order:
 *
 *   1. `getNextTransitions` lists every transition structurally configured
 *      on the current state, guard results notwithstanding. If `event`
 *      isn't among them, it isn't defined for this state at all
 *      -> `INVALID_TRANSITION`.
 *   2. `ticketStatusMachine.getTransitionData` performs that same lookup
 *      but evaluates guards. An empty result means the event IS defined for
 *      this state but its guard rejected the given context
 *      -> `GUARD_FAILED`.
 *
 * Only once both checks pass do we compute the resulting snapshot via the
 * pure `transition()` function to read off `nextStatus`.
 */
export function evaluateTicketTransition(
  current: TicketStatus,
  event: TicketEvent,
  ctx: TransitionContext,
): TransitionResult {
  const machineEvent: TicketStatusMachineEvent = { type: event };
  const snapshot = ticketStatusMachine.resolveState({
    value: current,
    context: ctx,
  });

  const isEventStructurallyDefined = getNextTransitions(snapshot).some(
    (candidate) => candidate.eventType === event,
  );
  if (!isEventStructurallyDefined) {
    return { allowed: false, reason: 'INVALID_TRANSITION' };
  }

  const guardEvaluatedTransitions = ticketStatusMachine.getTransitionData(
    snapshot,
    machineEvent,
  );
  if (guardEvaluatedTransitions.length === 0) {
    return { allowed: false, reason: 'GUARD_FAILED' };
  }

  const [nextSnapshot] = transition(
    ticketStatusMachine,
    snapshot,
    machineEvent,
  );
  return { allowed: true, nextStatus: nextSnapshot.value };
}
