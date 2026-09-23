/** What Express accepts for its `trust proxy` setting; `false` means nothing in front of us is trusted. */
export type TrustProxySetting = false | number | string[];

const DISABLED_VALUE = 'false';
// A hop count, never 0: "trust 0 proxies" is just the disabled state spelled confusingly.
const HOP_COUNT_PATTERN = /^[1-9]\d*$/;
// Express' named address ranges, usable in place of explicit addresses.
const PRESETS = ['loopback', 'linklocal', 'uniquelocal'];
// An IPv4/IPv6 address or CIDR block; Express does the exact parsing, this only rejects junk. The
// separator is required, so a bare number cannot pass as an address (a malformed hop count would).
const ADDRESS_PATTERN = /^[0-9a-fA-F.:]*[.:][0-9a-fA-F.:]*(\/\d{1,3})?$/;

const listEntries = (value: string): string[] =>
  value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

/**
 * `true` is deliberately not accepted: it makes Express take the client-supplied left-most
 * `X-Forwarded-For` entry as the caller's IP, so anyone could forge a fresh IP per request and
 * walk around the per-IP rate limits. A hop count or an explicit proxy whitelist cannot be forged.
 */
export const isTrustProxyValue = (value: string): boolean => {
  const trimmed = value.trim();
  if (trimmed === DISABLED_VALUE || HOP_COUNT_PATTERN.test(trimmed)) {
    return true;
  }
  const entries = listEntries(trimmed);
  return entries.length > 0 && entries.every((entry) => PRESETS.includes(entry) || ADDRESS_PATTERN.test(entry));
};

/** Turns the validated `TRUST_PROXY` value into the setting Express expects. Unset = disabled. */
export const parseTrustProxy = (value: string | undefined): TrustProxySetting => {
  const trimmed = value?.trim() ?? '';
  if (trimmed === '' || trimmed === DISABLED_VALUE) {
    return false;
  }
  return HOP_COUNT_PATTERN.test(trimmed) ? Number(trimmed) : listEntries(trimmed);
};
