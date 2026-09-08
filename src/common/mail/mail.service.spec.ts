import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getLoggerToken } from 'nestjs-pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NodeEnv } from '../../config/env.validation.js';
import { MailService } from './mail.service.js';

const MESSAGE = { to: 'jane@example.com', subject: 'Hello', text: 'Body with a secret token' };

describe('MailService (stub transport)', () => {
  const pinoLogger = { info: vi.fn(), warn: vi.fn() };

  const buildService = async (nodeEnv: NodeEnv): Promise<MailService> => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailService,
        { provide: getLoggerToken(MailService.name), useValue: pinoLogger },
        { provide: ConfigService, useValue: { getOrThrow: () => nodeEnv } },
      ],
    }).compile();
    return module.get<MailService>(MailService);
  };

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('logs the full message outside production so flows can be exercised by hand', async () => {
    const service = await buildService(NodeEnv.Development);

    await service.send(MESSAGE);

    expect(pinoLogger.info).toHaveBeenCalledWith(MESSAGE, 'Email (stub transport)');
  });

  it('never logs recipient or body in production — only a loud warning that nothing was sent', async () => {
    const service = await buildService(NodeEnv.Production);

    await service.send(MESSAGE);

    expect(pinoLogger.info).not.toHaveBeenCalled();
    const [payload, logMessage] = pinoLogger.warn.mock.calls[0];
    expect(payload).toEqual({ subject: MESSAGE.subject });
    expect(JSON.stringify([payload, logMessage])).not.toContain(MESSAGE.to);
  });
});
