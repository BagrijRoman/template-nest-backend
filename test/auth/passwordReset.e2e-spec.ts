import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module.js';
import {
  MailMessage,
  MailService,
} from '../../src/common/mail/mail.service.js';

describe('Password reset flow (e2e)', () => {
  let app: INestApplication<App>;
  let connection: Connection;
  let refreshToken: string;
  let sentMails: MailMessage[];

  // Email is unique to this spec file: e2e files run in parallel against the same database.
  const email = 'reset.jane@example.com';
  const password = 'Secret123';
  const newPassword = 'NewSecret456';

  const forgot = (body: Record<string, unknown>) =>
    request(app.getHttpServer()).post('/auth/forgot-password').send(body);
  const reset = (body: Record<string, unknown>) =>
    request(app.getHttpServer()).post('/auth/reset-password').send(body);
  const latestMailedToken = () =>
    sentMails.at(-1)?.text.match(/[0-9a-f]{64}/)?.[0];

  beforeEach(async () => {
    sentMails = [];
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      // Captures outgoing mail so tests can read the reset token the way a user would.
      .overrideProvider(MailService)
      .useValue({
        send: (message: MailMessage) => {
          sentMails.push(message);
          return Promise.resolve();
        },
      })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    connection = app.get<Connection>(getConnectionToken());
    await connection.collection('users').deleteMany({ email });

    const signUpResponse = await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({ email, firstName: 'Jane', lastName: 'Doe', password })
      .expect(201);
    refreshToken = signUpResponse.body.refreshToken;
    // Sign-up sends a verification email — drop it so tests count only reset mails.
    sentMails.length = 0;
  });

  afterEach(async () => {
    await app.close();
  });

  it('answers 204 for known and unknown emails alike, and only the known one gets a mail', async () => {
    await forgot({ email }).expect(204);
    await forgot({ email: 'reset.ghost@example.com' }).expect(204);

    expect(sentMails).toHaveLength(1);
    expect(sentMails[0].to).toBe(email);
    expect(latestMailedToken()).toBeDefined();
  });

  it('resets the password end to end and revokes every session', async () => {
    await forgot({ email }).expect(204);

    await reset({ token: latestMailedToken(), newPassword }).expect(204);

    // Old password dead, new one works, pre-reset refresh token revoked.
    await request(app.getHttpServer())
      .post('/auth/sign-in')
      .send({ email, password })
      .expect(401);
    await request(app.getHttpServer())
      .post('/auth/sign-in')
      .send({ email, password: newPassword })
      .expect(200);
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken })
      .expect(401);
  });

  it('a reset token works exactly once', async () => {
    await forgot({ email }).expect(204);
    const token = latestMailedToken();

    await reset({ token, newPassword }).expect(204);
    const response = await reset({
      token,
      newPassword: 'AnotherSecret789',
    }).expect(400);

    expect(response.body.message).toBe('Invalid or expired reset token');
  });

  it('requesting a new token invalidates the previous one', async () => {
    await forgot({ email }).expect(204);
    const firstToken = latestMailedToken();
    await forgot({ email }).expect(204);

    await reset({ token: firstToken, newPassword }).expect(400);
    await reset({ token: latestMailedToken(), newPassword }).expect(204);
  });

  it('rejects garbage tokens and weak new passwords', async () => {
    const forged = await reset({ token: 'a'.repeat(64), newPassword }).expect(
      400,
    );
    expect(forged.body.message).toBe('Invalid or expired reset token');

    await forgot({ email }).expect(204);
    const weak = await reset({
      token: latestMailedToken(),
      newPassword: 'weak',
    }).expect(400);
    expect(weak.body.details).toContain(
      'newPassword must be at least 8 characters long',
    );
  });
});
