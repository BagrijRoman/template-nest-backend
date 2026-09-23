import type { Type } from '@nestjs/common';
import type { ApiPropertyOptions } from '@nestjs/swagger';
import { z } from 'zod';

// The static hook @nestjs/swagger's CLI plugin would otherwise emit: Swagger calls it while building
// a model, so the OpenAPI schema is derived from the zod schema without any @ApiProperty decorator.
const OPENAPI_METADATA_FACTORY = '_OPENAPI_METADATA_FACTORY';

/** A DTO class produced by `createZodDto`: Nest sees a class in the controller signature, the pipe finds the schema on it. */
export interface ZodDto<TSchema extends z.ZodObject = z.ZodObject> extends Type<z.output<TSchema>> {
  readonly schema: TSchema;
  [OPENAPI_METADATA_FACTORY](): Record<string, ApiPropertyOptions>;
}

type JsonSchema = z.core.JSONSchema.BaseSchema;

const isSafeIntegerBound = (value: unknown): boolean =>
  value === Number.MAX_SAFE_INTEGER || value === Number.MIN_SAFE_INTEGER;

const toApiProperty = (
  { pattern, minimum, maximum, ...property }: JsonSchema,
  isRequired: boolean,
): ApiPropertyOptions =>
  ({
    ...property,
    // A named format (email, uuid, …) already documents the shape; the backing regex would only clutter the docs.
    ...(property.format ? {} : { pattern }),
    // `.int()` emits the safe-integer bounds as limits; they are noise, not a rule anyone chose.
    ...(isSafeIntegerBound(minimum) ? {} : { minimum }),
    ...(isSafeIntegerBound(maximum) ? {} : { maximum }),
    required: isRequired,
  }) as ApiPropertyOptions;

const openApiProperties = (schema: z.ZodObject): Record<string, ApiPropertyOptions> => {
  const { properties = {}, required = [] } = z.toJSONSchema(schema, {
    io: 'input',
    target: 'openapi-3.0',
    unrepresentable: 'any',
  });
  return Object.fromEntries(
    Object.entries(properties)
      // JSON Schema allows a bare boolean as a property schema; an object schema never produces one.
      .filter((entry): entry is [string, JsonSchema] => typeof entry[1] === 'object')
      .map(([key, property]) => [key, toApiProperty(property, required.includes(key))]),
  );
};

/** Builds the DTO class for a zod object schema: `class SignInDto extends createZodDto(signInSchema) {}`. */
export const createZodDto = <TSchema extends z.ZodObject>(schema: TSchema): ZodDto<TSchema> => {
  class Dto {
    static readonly schema = schema;

    static [OPENAPI_METADATA_FACTORY](): Record<string, ApiPropertyOptions> {
      return openApiProperties(schema);
    }
  }
  return Dto as unknown as ZodDto<TSchema>;
};

export const isZodDto = (metatype: unknown): metatype is ZodDto =>
  typeof metatype === 'function' && 'schema' in metatype && metatype.schema instanceof z.ZodObject;
