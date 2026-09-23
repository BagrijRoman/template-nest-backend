import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { createHash } from 'node:crypto';
import { Connection } from 'mongoose';
import request from 'supertest';
import type { Server } from 'node:http';
import { AppModule } from '../../src/app.module.js';

const MS_PER_SECOND = 1000;
const CLOCK_MARGIN_MS = 50;

const issuedAtSeconds = (accessToken: string): number => {
  const [, payload] = accessToken.split('.');
  return JSON.parse(Buffer.from(payload, 'base64').toString()).iat;
};

// A token minted in the very same second as the revocation is kept on purpose (`iat` has second
// precision — see JwtAuthGuard), so the clock has to leave that second before the test revokes.
const leaveTokenSecond = (accessToken: string): Promise<void> => {
  const nextSecond = (issuedAtSeconds(accessToken) + 1) * MS_PER_SECOND;
  return new Promise((resolve) =>
    setTimeout(resolve, Math.max(0, nextSecond - Date.now()) + CLOCK_MARGIN_MS),
  );
};

// The access token is a bearer credential with a TTL of its own: these cover the window in which it
// would otherwise keep working after the password behind it was taken away from its holder.
describe('Access token revocation (e2e)', () => {
  let app: INestApplication<Server>;
  let connection: Connection;
  let accessToken: string;

  // Email is unique to this spec file: e2e files run in parallel against the same database.
  const email = 'revocation.jane@example.com';
  const password = 'Secret123';

  const getMe = (token: string) =>
    request(app.getHttpServer())
      .get('/users/me')
      .set('Authorization', `Bearer ${token}`);

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

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

  it('retires the access tokens of every other device when the password changes', async () => {
    await getMe(accessToken).expect(200);
    await leaveTokenSecond(accessToken);

    const changeResponse = await request(app.getHttpServer())
      .post('/auth/change-password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: password, newPassword: 'NewSecret123' })
      .expect(200);

    await getMe(accessToken).expect(401);
    // The pair the change hands back is issued after the cutoff and must keep working.
    await getMe(changeResponse.body.accessToken).expect(200);
  });

  it('retires the access tokens when the password is reset through the email flow', async () => {
    await leaveTokenSecond(accessToken);
    await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ email })
      .expect(204);

    // The raw token exists only in the email; the store keeps its hash, so the flow is driven by
    // replacing that hash with the hash of a token this test knows.
    const rawToken = 'e2e-reset-token';
    const user = await connection.collection('users').findOne({ email });
    const updated = await connection
      .collection('passwordresettokens')
      .updateOne(
        { userId: user?._id.toString() },
        {
          $set: {
            tokenHash: createHash('sha256').update(rawToken).digest('hex'),
          },
        },
      );
    expect(updated.modifiedCount).toBe(1);

    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ token: rawToken, newPassword: 'NewSecret123' })
      .expect(204);

    await getMe(accessToken).expect(401);
  });
});
