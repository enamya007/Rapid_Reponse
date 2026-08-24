import { ApiProperty } from '@nestjs/swagger';

// Raw row shape produced by `TechnicianSuggestionService.suggestForTicket`'s query
// (`getRawMany()`), matching exactly the aliases that query's `SELECT` list assigns. Kept here
// (not in the service) so the DTO and the one place allowed to construct it stay next to each
// other and can never silently drift.
export interface TechnicianSuggestionRawRow {
  userId: string;
  username: string;
  firstName: string | null;
  lastName: string | null;
  maxConcurrentTickets: number | string;
  currentLoad: number | string;
  skillLevel: number | string | null;
}

// P5 contract §5 (`docs/plan-P5-contracts.md`) — figée:
// `{ technicianId, username, firstName, lastName, skillLevel, currentLoad, maxConcurrentTickets }`.
// Consultative only (D6): never triggers an assignment by itself.
export class TechnicianSuggestionDto {
  @ApiProperty({ description: 'userId of the candidate technician (D4)' })
  technicianId: string;

  @ApiProperty()
  username: string;

  @ApiProperty({ type: String, nullable: true })
  firstName: string | null;

  @ApiProperty({ type: String, nullable: true })
  lastName: string | null;

  // `null` when the ticket's category has no `requiredSkillId` (P5 contract §4.3 step 5): every
  // candidate is then kept regardless of skills, with no level to report.
  @ApiProperty({
    type: Number,
    nullable: true,
    minimum: 1,
    maximum: 5,
    description:
      "The candidate's level on the ticket category's required skill, or null when the " +
      'category has no required skill',
  })
  skillLevel: number | null;

  @ApiProperty()
  currentLoad: number;

  @ApiProperty()
  maxConcurrentTickets: number;

  // Raw driver values for numeric columns come back typed loosely by `pg` (a plain `int4`
  // column is parsed to a JS `number`, but this stays defensive against a `string` regardless of
  // exactly which numeric SQL type produced it), hence the `Number(...)` normalization below.
  static fromRaw(row: TechnicianSuggestionRawRow): TechnicianSuggestionDto {
    const dto = new TechnicianSuggestionDto();
    dto.technicianId = row.userId;
    dto.username = row.username;
    dto.firstName = row.firstName;
    dto.lastName = row.lastName;
    dto.skillLevel =
      row.skillLevel === null || row.skillLevel === undefined
        ? null
        : Number(row.skillLevel);
    dto.currentLoad = Number(row.currentLoad);
    dto.maxConcurrentTickets = Number(row.maxConcurrentTickets);
    return dto;
  }
}
