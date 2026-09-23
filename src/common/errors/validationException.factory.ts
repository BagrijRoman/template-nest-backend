import { HttpStatus } from '@nestjs/common';
import type { z } from 'zod';
import { AppException } from './app.exception.js';
import { ErrorCode } from './errorCode.js';
import type { FieldError } from './errorResponse.dto.js';

export const VALIDATION_FAILED_MESSAGE = 'Validation failed';

type Issue = z.core.$ZodIssue;

const capitalize = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1);
const camelCase = (snakeCase: string): string =>
  snakeCase.replace(/_(\w)/g, (_, letter: string) => letter.toUpperCase());

// Rule names keep class-validator's vocabulary (`isEmail`, `isNotEmpty`, `minLength`, …): they are part
// of the error contract clients already branch on, so swapping the validator must not rename them.
const issueRule = (issue: Issue): string => {
  switch (issue.code) {
    case 'invalid_type':
      return `is${capitalize(issue.expected)}`;
    case 'invalid_format':
      return issue.format === 'regex' ? 'matches' : `is${capitalize(camelCase(issue.format))}`;
    case 'too_small':
      if (issue.origin === 'string') {
        return issue.minimum === 1 ? 'isNotEmpty' : 'minLength';
      }
      return issue.origin === 'array' ? 'arrayMinSize' : 'min';
    case 'too_big':
      if (issue.origin === 'string') {
        return 'maxLength';
      }
      return issue.origin === 'array' ? 'arrayMaxSize' : 'max';
    case 'invalid_value':
      return 'isEnum';
    case 'unrecognized_keys':
      return 'whitelistValidation';
    case 'custom':
      return typeof issue.params?.rule === 'string' ? issue.params.rule : 'custom';
    default:
      return camelCase(issue.code);
  }
};

/** One entry per failed rule; nested paths are dotted (`address.city`), like the flattened class-validator tree was. */
const toFieldError = (issue: Issue): FieldError => ({
  field: issue.path.map(String).join('.'),
  rule: issueRule(issue),
  message: issue.message,
});

/** Used by the global `ZodValidationPipe` so validation errors carry structured, per-field details. */
export const validationExceptionFactory = (issues: readonly Issue[]): AppException =>
  new AppException(HttpStatus.BAD_REQUEST, ErrorCode.ValidationFailed, VALIDATION_FAILED_MESSAGE, {
    details: issues.map(toFieldError),
  });
