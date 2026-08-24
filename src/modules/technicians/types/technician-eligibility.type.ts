// P5 contract §4.1 (`docs/plan-P5-contracts.md`) — figée. Shared shape returned by
// `TechnicianSuggestionService.evaluateEligibility`, consumed by T5.3 (affectation) to decide
// whether `POST /tickets/:id/assign` may target a given technician (D1).
//
// Evaluation order (the FIRST failure wins, so the caller always gets one, unambiguous reason):
//   NOT_FOUND -> NOT_A_TECHNICIAN -> INACTIVE (inactive OR soft-deleted) -> NO_PROFILE ->
//   UNAVAILABLE -> AT_CAPACITY.
export type TechnicianEligibilityReason =
  | 'NOT_FOUND'
  | 'NOT_A_TECHNICIAN'
  | 'INACTIVE'
  | 'NO_PROFILE'
  | 'UNAVAILABLE'
  | 'AT_CAPACITY';

export interface TechnicianEligibility {
  eligible: boolean;
  reason?: TechnicianEligibilityReason;
  // `0` on every early-exit branch where no `TechnicianProfile` was loaded yet (NOT_FOUND,
  // NOT_A_TECHNICIAN, INACTIVE, NO_PROFILE): there is nothing meaningful to report. Populated
  // with the real values from the moment a profile is available (UNAVAILABLE onward).
  currentLoad: number;
  maxConcurrentTickets: number;
}
