import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { NodeEnv } from '../../config/env.validation.js';

export type MailMessage = {
  to: string;
  subject: string;
  text: string;
};

/**
 * Stub transport: no email leaves the system — the message is logged instead. Every mail-sending
 * flow (security notifications, the password-reset flow, …) codes against this service, so a real
 * provider later becomes one adapter swap, not a flow rewrite.
 *
 * Outside production the full message (recipient and body) is logged so flows can be exercised by
 * hand — e.g. reading a reset token straight from the dev log. In production only pseudonymous
 * metadata is logged: bodies carry secrets and recipients are PII.
 */
@Injectable()
export class MailService {
  private readonly isProduction: boolean;

  constructor(
    @InjectPinoLogger(MailService.name)
    private readonly logger: PinoLogger,
    config: ConfigService,
  ) {
    this.isProduction = config.getOrThrow<NodeEnv>('NODE_ENV') === NodeEnv.Production;
  }

  async send(message: MailMessage): Promise<void> {
    if (this.isProduction) {
      this.logger.warn({ subject: message.subject }, 'Email NOT sent: the stub mail transport is active in production');
      return;
    }
    this.logger.info({ to: message.to, subject: message.subject, text: message.text }, 'Email (stub transport)');
  }
}
