import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import request from 'supertest';
import type { Server } from 'node:http';
import { AppModule } from '../../src/app.module.js';
import {
  MailMessage,
  MailService,
} from '../../src/common/mail/mail.service.js';

describe('Email verification flow (e2e)', () => {
  let app: INestApplication<Server>;
  let connection: Connection;
  let accessToken: string;
  let sentMails: MailMessage[];

  // Email is unique to this spec file: e2e files run in parallel against the same database.
  const email = 'verify.jane@example.com';
  const password = 'Secret123';

  const verify = (body: Record<string, unknown>) =>
    request(app.getHttpServer()).post('/auth/verify-email').send(body);
  const resend = (body: Record<string, unknown>) =>
    request(app.getHttpServer()).post('/auth/resend-verification').send(body);
  const getMe = () =>
    request(app.getHttpServer())
      .get('/users/me')
      .set('Authorization', `Bearer ${accessToken}`);
  const latestMailedToken = () =>
    sentMails.at(-1)?.text.match(/[0-9a-f]{64}/)?.[0];

  beforeEach(async () => {
    sentMails = [];
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      // Captures outgoing mail so tests can read the verification token the way a user would.
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
    accessToken = signUpResponse.body.accessToken;
  });

  afterEach(async () => {
    await app.close();
  });

  it('sign-up creates an unverified account, still issues tokens and sends a verification email', async () => {
    const me = await getMe().expect(200);

    expect(me.body.emailVerified).toBe(false);
    expect(sentMails).toHaveLength(1);
    expect(sentMails[0].to).toBe(email);
    expect(sentMails[0].subject).toContain('Verify');
    expect(latestMailedToken()).toBeDefined();
  });

  it('verifies the email end to end, exactly once per token', async () => {
    const token = latestMailedToken();

    await verify({ token }).expect(204);
    expect((await getMe().expect(200)).body.emailVerified).toBe(true);

    const replay = await verify({ token }).expect(400);
    expect(replay.body.message).toBe('Invalid or expired verification token');
  });

  it('resends a fresh token that invalidates the previous one', async () => {
    const firstToken = latestMailedToken();
    await resend({ email }).expect(204);

    await verify({ token: firstToken }).expect(400);
    await verify({ token: latestMailedToken() }).expect(204);
  });

  it('answers resend with 204 for unknown emails and verified accounts, sending nothing', async () => {
    await verify({ token: latestMailedToken() }).expect(204);
    const mailsBefore = sentMails.length;

    await resend({ email: 'verify.ghost@example.com' }).expect(204);
    await resend({ email }).expect(204);

    expect(sentMails).toHaveLength(mailsBefore);
  });

  it('rejects a forged token with the generic 400', async () => {
    const response = await verify({ token: 'a'.repeat(64) }).expect(400);

    expect(response.body.message).toBe('Invalid or expired verification token');
  });
});
