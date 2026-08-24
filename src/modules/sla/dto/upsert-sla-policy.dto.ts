import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';

// One year in minutes. An upper bound is not bureaucracy: `resolveSlaDueAt` adds
// `resolutionTargetMinutes * 60_000` to `Date.now()`, and a large enough value overflows into an
// `Invalid Date`, which would be written to `slaDueAt` as null and silently disable the SLA for
// that priority.
const MAX_RESOLUTION_TARGET_MINUTES = 525_600;

// P6.5 contract §3 (`docs/plan-P6.5-contracts.md`) — figée. `priority` is not part of the body:
// it is the route parameter, so there is no way to send a body that disagrees with the URL.
export class UpsertSlaPolicyDto {
  @ApiProperty({
    example: 240,
    minimum: 1,
    maximum: MAX_RESOLUTION_TARGET_MINUTES,
    description: 'Resolution target in minutes, counted from ticket creation.',
  })
  @IsInt()
  @Min(1)
  @Max(MAX_RESOLUTION_TARGET_MINUTES)
  resolutionTargetMinutes: number;
}
