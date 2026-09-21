import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ErrorCode } from './errorCode.js';

/** One failed rule on one input field; validation errors and field-bound business errors both use it. */
export class FieldErrorDto {
  @ApiProperty({ example: 'email', description: 'Dotted path of the offending field' })
  field: string;

  @ApiProperty({
    example: 'isEmail',
    description: 'The rule that failed (class-validator constraint or a business rule)',
  })
  rule: string;

  @ApiProperty({ example: 'email must be a valid email address' })
  message: string;
}

/** The single error shape every client-facing error is normalized to. */
export class ErrorResponseDto {
  @ApiProperty({ example: 400 })
  statusCode: number;

  @ApiProperty({ example: 'Bad Request', description: 'HTTP status text' })
  error: string;

  @ApiProperty({ enum: ErrorCode, example: ErrorCode.ValidationFailed, description: 'Stable machine-readable code' })
  code: ErrorCode;

  @ApiProperty({ example: 'Validation failed', description: 'Human-readable summary, safe to show to the user' })
  message: string;

  @ApiPropertyOptional({
    type: [FieldErrorDto],
    description: 'Per-field problems, when the error concerns input fields',
  })
  details?: FieldErrorDto[];

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    example: { retryAfterSeconds: 900 },
    description: 'Extra machine-readable context specific to the code (e.g. retryAfterSeconds on 429)',
  })
  meta?: Record<string, unknown>;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: '/auth/sign-in' })
  path: string;
}

export type FieldError = FieldErrorDto;
export type ErrorResponseBody = ErrorResponseDto;
