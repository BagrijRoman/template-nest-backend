import { z } from 'zod';
import { createZodDto } from '../validation/index.js';

export const PAGE_LIMIT_DEFAULT = 20;
export const PAGE_LIMIT_MAX = 100;

/** The `limit` / `offset` query every list endpoint takes; query strings arrive as text, so both are coerced. */
export class PaginationQueryDto extends createZodDto(
  z.object({
    limit: z.coerce
      .number({ error: 'limit must be a number' })
      .int({ error: 'limit must be an integer' })
      .min(1, { error: 'limit must be at least 1' })
      .max(PAGE_LIMIT_MAX, { error: `limit must be at most ${PAGE_LIMIT_MAX}` })
      .default(PAGE_LIMIT_DEFAULT)
      .meta({ description: 'Page size' }),
    offset: z.coerce
      .number({ error: 'offset must be a number' })
      .int({ error: 'offset must be an integer' })
      .min(0, { error: 'offset must be at least 0' })
      .default(0)
      .meta({ description: 'Number of items to skip' }),
  }),
) {}
