// Stricter than the global limit: sign-in is a brute-force target and sign-up an account-spam target.
export const AUTH_THROTTLE_TTL_MS = 60_000;
export const AUTH_THROTTLE_LIMIT = 10;

// Per-account lockout: after this many failed sign-ins the email is locked for the window below;
// every further failure slides the window forward.
export const MAX_FAILED_SIGN_IN_ATTEMPTS = 5;
export const SIGN_IN_LOCKOUT_WINDOW_MS = 15 * 60_000;

// Short-lived by design: a reset token arrives over email, the least trusted channel in the flow.
export const PASSWORD_RESET_TOKEN_TTL_MS = 30 * 60_000;
