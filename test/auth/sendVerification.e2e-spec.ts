import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module.js';
import { EMAIL_ACTION_LIMIT } from '../../src/auth/auth.constants.js';
import {
  MailMessage,
  MailService,
} from '../../src/common/mail/mail.service.js';

describe('POST /auth/send-verification (e2e)', () => {
  let app: INestApplication<App>;
  let connection: Connection;
  let accessToken: string;
  let sentMails: MailMessage[];

  // Email is unique to this spec file: e2e files run in parallel against the same database.
  const email = 'sendverify.jane@example.com';

  const sendVerification = (token = accessToken) =>
    request(app.getHttpServer())
      .post('/auth/send-verification')
      .set('Authorization', `Bearer ${token}`)
      .send({});
  const latestMailedToken = () =>
    sentMails.at(-1)?.text.match(/[0-9a-f]{64}/)?.[0];

  beforeEach(async () => {
    sentMails = [];
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
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
    await connection.collection('accountactioncounters').deleteMany({});

    const signUpResponse = await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({
        email,
        firstName: 'Jane',
        lastName: 'Doe',
        password: 'Secret123',
      })
      .expect(201);
    accessToken = signUpResponse.body.accessToken;
    // Sign-up sends a verification email — drop it so tests count only their own mail.
    sentMails.length = 0;
  });

  afterEach(async () => {
    await app.close();
  });

  it('sends a verification email for the token-identified caller — no email in the body', async () => {
    await sendVerification().expect(204);

    expect(sentMails).toHaveLength(1);
    expect(sentMails[0].to).toBe(email);
    expect(sentMails[0].subject).toContain('Verify');
  });

  it('demands an access token — the route is not public', async () => {
    await request(app.getHttpServer())
      .post('/auth/send-verification')
      .send({})
      .expect(401);
  });

  it('answers 400 once the email is already verified', async () => {
    await sendVerification().expect(204);
    await request(app.getHttpServer())
      .post('/auth/verify-email')
      .send({ token: latestMailedToken() })
      .expect(204);

    const response = await sendVerification().expect(400);
    expect(response.body.message).toBe('Email is already verified');
  });

  it(`blocks the account after ${EMAIL_ACTION_LIMIT} requests with 429 and one security-alert email`, async () => {
    for (let attempt = 0; attempt < EMAIL_ACTION_LIMIT; attempt += 1) {
      await sendVerification().expect(204);
    }

    const blocked = await sendVerification().expect(429);
    expect(blocked.body.message).toBe(
      'Too many verification emails requested, try again later',
    );

    // 3 verification mails + exactly one alert, addressed to the owner.
    const alerts = sentMails.filter((mail) =>
      mail.subject.startsWith('Security alert'),
    );
    expect(sentMails).toHaveLength(EMAIL_ACTION_LIMIT + 1);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].to).toBe(email);
  });
});
