// Global per-IP rate limits, enforced together: a sustained window and a short burst window
// that cuts request floods off within a second instead of a minute. Auth endpoints additionally
// carry a stricter profile (see auth.constants.ts). App-level throttling only blunts basic
// floods — real DDoS protection belongs upstream (CDN/WAF).
export const THROTTLE_TTL_MS = 60_000;
export const THROTTLE_LIMIT = 100;
export const BURST_THROTTLE_TTL_MS = 1000;
export const BURST_THROTTLE_LIMIT = 20;
