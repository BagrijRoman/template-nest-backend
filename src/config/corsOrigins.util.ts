/** Splits the CORS_ORIGINS env value ("https://a.com, https://b.com") into an origin whitelist. */
export const parseCorsOrigins = (value: string | undefined): string[] =>
  value
    ?.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0) ?? [];
