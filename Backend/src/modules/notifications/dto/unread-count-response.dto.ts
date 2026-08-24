import { ApiProperty } from '@nestjs/swagger';

// P6 contract §7 (`docs/plan-P6-contracts.md`): `GET /notifications/unread-count` -> `200
// { count: number }`.
export class UnreadCountResponseDto {
  @ApiProperty({ example: 3 })
  count: number;
}
