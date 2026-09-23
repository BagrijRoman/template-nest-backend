import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import request from 'supertest';
import type { Server } from 'node:http';
import { AppModule } from '../../src/app.module.js';

const PHONE_AGENT = 'TemplateApp/1.0 (iPhone)';
const LAPTOP_AGENT = 'Mozilla/5.0 (Macintosh)';

describe('Device sessions (e2e)', () => {
  let app: INestApplication<Server>;
  let connection: Connection;
  let userId: string;
  let phone: { accessToken: string; refreshToken: string };
  let laptop: { accessToken: string; refreshToken: string };

  // Email is unique to this spec file: e2e files run in parallel against the same database.
  const email = 'sessions.jane@example.com';
  const password = 'Secret123';

  const signIn = async (userAgent: string) => {
    const response = await request(app.getHttpServer())
      .post('/auth/sign-in')
      .set('User-Agent', userAgent)
      .send({ email, password })
      .expect(200);
    return {
      accessToken: response.body.accessToken,
      refreshToken: response.body.refreshToken,
    };
  };

  const listSessions = (accessToken: string) =>
    request(app.getHttpServer())
      .get('/auth/sessions')
      .set('Authorization', `Bearer ${accessToken}`);

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
    userId = signUpResponse.body.user.id;

    phone = await signIn(PHONE_AGENT);
    laptop = await signIn(LAPTOP_AGENT);
  });

  afterEach(async () => {
    await app.close();
  });

  it('lists one session per device, marking the one the request came from', async () => {
    const response = await listSessions(laptop.accessToken).expect(200);

    // Sign-up opened one session too, so three devices are signed in.
    expect(response.body).toHaveLength(3);
    expect(
      response.body.map((session: { current: boolean }) => session.current),
    ).toEqual([true, false, false]);
    expect(response.body[0]).toMatchObject({
      userAgent: LAPTOP_AGENT,
      current: true,
    });
    expect(response.body[1]).toMatchObject({
      userAgent: PHONE_AGENT,
      current: false,
    });
    expect(response.body[0].id).toMatch(/^[0-9a-f]{24}$/);
  });

  it('keeps a session alive across rotation instead of opening another one', async () => {
    const refreshResponse = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: phone.refreshToken })
      .expect(200);

    const response = await listSessions(
      refreshResponse.body.accessToken,
    ).expect(200);

    expect(response.body).toHaveLength(3);
    // The rotated device is the current one again, and it is the phone's session, not a new row.
    expect(
      response.body.find((session: { current: boolean }) => session.current),
    ).toMatchObject({
      userAgent: PHONE_AGENT,
    });
  });

  it('signs one device out: its refresh token dies and it leaves the list', async () => {
    const sessions = await listSessions(laptop.accessToken).expect(200);
    const phoneSession = sessions.body.find(
      (session: { userAgent?: string }) => session.userAgent === PHONE_AGENT,
    );

    await request(app.getHttpServer())
      .delete(`/auth/sessions/${phoneSession.id}`)
      .set('Authorization', `Bearer ${laptop.accessToken}`)
      .expect(204);

    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: phone.refreshToken })
      .expect(401);

    const after = await listSessions(laptop.accessToken).expect(200);
    expect(after.body).toHaveLength(2);
    expect(
      await connection
        .collection('refreshtokens')
        .countDocuments({ sessionId: phoneSession.id }),
    ).toBe(0);
  });

  it('answers 404 for a session that is not the callers, leaving it alone', async () => {
    const otherEmail = 'sessions.john@example.com';
    await connection.collection('users').deleteMany({ email: otherEmail });
    const otherSignUp = await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({ email: otherEmail, firstName: 'John', lastName: 'Roe', password })
      .expect(201);

    const sessions = await listSessions(laptop.accessToken).expect(200);
    const victimSession = sessions.body[0];

    await request(app.getHttpServer())
      .delete(`/auth/sessions/${victimSession.id}`)
      .set('Authorization', `Bearer ${otherSignUp.body.accessToken}`)
      .expect(404);

    expect(await listSessions(laptop.accessToken).expect(200)).toMatchObject({
      body: sessions.body,
    });
  });

  it('answers 404 for a malformed session id', async () => {
    await request(app.getHttpServer())
      .delete('/auth/sessions/not-an-object-id')
      .set('Authorization', `Bearer ${laptop.accessToken}`)
      .expect(404);
  });

  it('logging out ends that device session alone', async () => {
    await request(app.getHttpServer())
      .post('/auth/logout')
      .send({ refreshToken: phone.refreshToken })
      .expect(204);

    const response = await listSessions(laptop.accessToken).expect(200);

    expect(response.body).toHaveLength(2);
    expect(
      response.body.map((session: { userAgent?: string }) => session.userAgent),
    ).not.toContain(PHONE_AGENT);
  });

  it('a password change ends every session and opens a single fresh one', async () => {
    const changeResponse = await request(app.getHttpServer())
      .post('/auth/change-password')
      .set('Authorization', `Bearer ${laptop.accessToken}`)
      .set('User-Agent', LAPTOP_AGENT)
      .send({ currentPassword: password, newPassword: 'NewSecret123' })
      .expect(200);

    const response = await listSessions(changeResponse.body.accessToken).expect(
      200,
    );

    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({
      userAgent: LAPTOP_AGENT,
      current: true,
    });
    expect(
      await connection.collection('sessions').countDocuments({ userId }),
    ).toBe(1);
  });

  it('rejects an unauthenticated caller', async () => {
    await request(app.getHttpServer()).get('/auth/sessions').expect(401);
  });
});
