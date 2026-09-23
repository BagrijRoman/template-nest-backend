import { Body, Controller, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createZodDto, isZodDto } from './zodDto.js';

const schema = z.object({
  email: z.string().email().meta({ example: 'jane@example.com' }),
  nickname: z.string().max(20).optional(),
  code: z.string().regex(/^\d{6}$/),
});

class SampleDto extends createZodDto(schema) {}
class DerivedDto extends SampleDto {}

@Controller('samples')
class SamplesController {
  @Post()
  create(@Body() dto: DerivedDto): DerivedDto {
    return dto;
  }
}

describe('createZodDto', () => {
  it('exposes the schema on the class and on subclasses', () => {
    expect(SampleDto.schema).toBe(schema);
    expect(DerivedDto.schema).toBe(schema);
    expect(isZodDto(SampleDto)).toBe(true);
    expect(isZodDto(DerivedDto)).toBe(true);
  });

  it('is not confused by plain classes or non-classes', () => {
    class PlainDto {}

    expect(isZodDto(PlainDto)).toBe(false);
    expect(isZodDto({ schema })).toBe(false);
    expect(isZodDto(undefined)).toBe(false);
  });

  it('describes every property for Swagger, with required flags and examples, dropping the regex behind a named format', () => {
    const metadata = SampleDto._OPENAPI_METADATA_FACTORY();

    expect(metadata.email).toMatchObject({
      type: 'string',
      format: 'email',
      example: 'jane@example.com',
      required: true,
    });
    expect(metadata.email).not.toHaveProperty('pattern');
    expect(metadata.nickname).toMatchObject({ type: 'string', maxLength: 20, required: false });
    expect(metadata.code).toMatchObject({ type: 'string', pattern: '^\\d{6}$', required: true });
  });

  it('lets Swagger build the request schema from the zod schema, through subclasses too', async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [SamplesController] }).compile();
    const app = moduleRef.createNestApplication();

    const document = SwaggerModule.createDocument(app, new DocumentBuilder().build());

    expect(document.components?.schemas?.DerivedDto).toMatchObject({
      type: 'object',
      required: ['email', 'code'],
      properties: {
        email: { type: 'string', format: 'email', example: 'jane@example.com' },
        nickname: { type: 'string', maxLength: 20 },
        code: { type: 'string', pattern: '^\\d{6}$' },
      },
    });
    await app.close();
  });
});
