import { Controller, Get } from '@nestjs/common';
import { ApiProperty, DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import {
  ApiPaginatedResponse,
  PaginatedResponseDto,
} from './paginated-response.dto';

// Minimal, standalone item DTO used only to prove that `ApiPaginatedResponse` produces a
// real schema referencing whatever concrete type it is given — not tied to any real
// business DTO, and no business module consumes these bricks yet.
class SampleItemDto {
  @ApiProperty({ example: 'id-1' })
  id: string;

  @ApiProperty({ example: 'sample' })
  name: string;
}

@Controller('sample')
class SampleController {
  @Get()
  @ApiPaginatedResponse(SampleItemDto)
  list(): PaginatedResponseDto<SampleItemDto> {
    return { data: [], meta: { total: 0, page: 1, limit: 20, totalPages: 0 } };
  }
}

// Loose local shape for the bits of the generated OpenAPI document this test inspects.
// `SchemaObject`/`ReferenceObject` are not part of `@nestjs/swagger`'s public exports.
interface LooseSchema {
  $ref?: string;
  type?: string;
  properties?: Record<string, LooseSchema>;
  items?: LooseSchema;
  allOf?: LooseSchema[];
}

function refName(schema: LooseSchema): string {
  const ref = schema.$ref;
  if (!ref) {
    throw new Error('Expected a $ref, got none');
  }
  return ref.split('/').pop() as string;
}

describe('ApiPaginatedResponse (generated OpenAPI schema)', () => {
  it('produces a non-empty, exploitable schema for the paginated response, not a bare object', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [SampleController],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();

    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('test').setVersion('1.0').build(),
    );

    const responseSchema = (
      document.paths['/sample'].get?.responses['200'] as {
        content: { 'application/json': { schema: LooseSchema } };
      }
    ).content['application/json'].schema;

    // The response schema is a real composition (allOf), not an empty `{}`.
    expect(responseSchema.allOf).toBeDefined();
    expect(responseSchema.allOf).toHaveLength(2);

    const schemas = document.components?.schemas as Record<string, LooseSchema>;
    expect(schemas).toBeDefined();

    // First member: the PaginatedResponseDto envelope itself, resolved from components.
    const paginatedSchema = schemas[refName(responseSchema.allOf![0])];
    expect(paginatedSchema).toBeDefined();
    expect(paginatedSchema.properties).toBeDefined();
    expect(Object.keys(paginatedSchema.properties!).length).toBeGreaterThan(0);

    // `meta` must resolve to a real schema documenting all 4 pagination fields.
    const metaSchema = schemas[refName(paginatedSchema.properties!.meta)];
    expect(metaSchema).toBeDefined();
    expect(Object.keys(metaSchema.properties ?? {}).sort()).toEqual(
      ['limit', 'page', 'total', 'totalPages'].sort(),
    );

    // Second member: the per-endpoint override making `data` a real array of SampleItemDto,
    // not a generic/empty object — this is exactly the pitfall a plain
    // `@ApiOkResponse({ type: PaginatedResponseDto })` would fall into.
    const dataOverride = responseSchema.allOf![1].properties!.data;
    expect(dataOverride.type).toBe('array');
    const itemSchemaName = refName(dataOverride.items!);
    expect(itemSchemaName).toContain('SampleItemDto');

    const itemSchema = schemas[itemSchemaName];
    expect(itemSchema.properties).toEqual(
      expect.objectContaining({
        id: expect.anything() as unknown,
        name: expect.anything() as unknown,
      }),
    );

    await app.close();
  });
});
