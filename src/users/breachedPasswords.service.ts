import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ToggleValue } from '../config/env.validation.js';

// haveibeenpwned range API, k-anonymity model: only the first 5 chars of the sha1 ever leave
// the server, the full password or hash never does.
const HIBP_RANGE_URL = 'https://api.pwnedpasswords.com/range/';
const HASH_PREFIX_LENGTH = 5;
const REQUEST_TIMEOUT_MS = 2500;

@Injectable()
export class BreachedPasswordsService {
  private readonly logger = new Logger(BreachedPasswordsService.name);
  private readonly isEnabled: boolean;

  constructor(config: ConfigService) {
    this.isEnabled = config.get<ToggleValue>('BREACHED_PASSWORD_CHECK') !== ToggleValue.Disabled;
  }

  /**
   * True when the password appears in a known breach. Fails open: if the external API is down or
   * slow, sign-up availability wins over an optional hardening check — the miss is only logged.
   */
  async isBreached(password: string): Promise<boolean> {
    if (!this.isEnabled) {
      return false;
    }

    const sha1 = createHash('sha1').update(password).digest('hex').toUpperCase();
    const prefix = sha1.slice(0, HASH_PREFIX_LENGTH);
    const suffix = sha1.slice(HASH_PREFIX_LENGTH);

    try {
      const response = await fetch(`${HIBP_RANGE_URL}${prefix}`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        // Padding makes every response the same shape; padded entries carry a count of 0.
        headers: { 'Add-Padding': 'true' },
      });
      if (!response.ok) {
        this.logger.warn(`Breached-password check skipped: HIBP answered ${response.status}`);
        return false;
      }

      const body = await response.text();
      return body.split('\n').some((line) => {
        const [candidateSuffix, count] = line.trim().split(':');
        return candidateSuffix === suffix && Number(count) > 0;
      });
    } catch (error) {
      this.logger.warn(`Breached-password check skipped: ${error instanceof Error ? error.message : 'unknown error'}`);
      return false;
    }
  }
}
