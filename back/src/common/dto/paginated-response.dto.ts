import { applyDecorators, Type } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiOkResponse,
  ApiProperty,
  ApiResponseOptions,
  getSchemaPath,
} from '@nestjs/swagger';

export class PaginationMetaDto {
  @ApiProperty({
    example: 42,
    description: 'Total number of items across all pages',
  })
  total: number;

  @ApiProperty({ example: 1, description: 'Current, 1-based page number' })
  page: number;

  @ApiProperty({ example: 20, description: 'Number of items per page' })
  limit: number;

  @ApiProperty({ example: 3, description: 'Total number of pages' })
  totalPages: number;
}

/**
 * Generic paginated response envelope: `{ data: T[], meta: PaginationMetaDto }`.
 *
 * TypeScript generics are erased at runtime, so `@nestjs/swagger`'s reflection-based
 * document generation cannot, on its own, know what `T` is for a given endpoint — it would
 * emit an empty/untyped schema for `data`. `data` is intentionally left with a placeholder
 * `@ApiProperty` below; per-endpoint controllers must use the `@ApiPaginatedResponse(ItemDto)`
 * decorator instead of `@ApiOkResponse({ type: PaginatedResponseDto })`, which builds an
 * explicit `allOf` schema referencing the concrete item DTO via `getSchemaPath`.
 */
export class PaginatedResponseDto<T> {
  @ApiProperty({
    type: 'array',
    items: { type: 'object' },
    description:
      'Page of results. The concrete item type is documented per-endpoint by @ApiPaginatedResponse().',
  })
  data: T[];

  @ApiProperty({ type: () => PaginationMetaDto })
  meta: PaginationMetaDto;
}

/**
 * Documents an endpoint returning a `PaginatedResponseDto<TModel>` with a real, exploitable
 * OpenAPI schema: `data` is a proper array of `$ref: TModel`, not an empty object. Registers
 * both `PaginatedResponseDto`/`PaginationMetaDto` and `dataDto` as extra models so they all
 * appear under `components.schemas`, then composes the response schema via `allOf`.
 *
 * Usage: `@ApiPaginatedResponse(TicketResponseDto)` on a controller method returning
 * `Promise<PaginatedResponseDto<TicketResponseDto>>`.
 */
export function ApiPaginatedResponse<TModel extends Type<unknown>>(
  dataDto: TModel,
  options?: Omit<ApiResponseOptions, 'schema'>,
): MethodDecorator {
  return applyDecorators(
    ApiExtraModels(PaginatedResponseDto, PaginationMetaDto, dataDto),
    ApiOkResponse({
      ...options,
      schema: {
        allOf: [
          { $ref: getSchemaPath(PaginatedResponseDto) },
          {
            properties: {
              data: {
                type: 'array',
                items: { $ref: getSchemaPath(dataDto) },
              },
            },
          },
        ],
      },
    }),
  );
}
