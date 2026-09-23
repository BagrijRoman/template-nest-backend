import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import request from 'supertest';
import type { Server } from 'node:http';
import { AppModule } from '../../src/app.module.js';

describe('PATCH /users/me (e2e)', () => {
  let app: INestApplication<Server>;
  let connection: Connection;
  let accessToken: string;

  // Email is unique to this spec file: e2e files run in parallel against the same database.
  const email = 'patchme.jane@example.com';

  const patchMe = (body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .patch('/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(body);

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
      .send({
        email,
        firstName: 'Jane',
        lastName: 'Doe',
        password: 'Secret123',
      })
      .expect(201);
    accessToken = signUpResponse.body.accessToken;
  });

  afterEach(async () => {
    await app.close();
  });

  it('updates the named fields, leaves the rest alone and persists the change', async () => {
    const response = await patchMe({ firstName: 'Janet' }).expect(200);

    expect(response.body).toMatchObject({
      firstName: 'Janet',
      lastName: 'Doe',
      email,
    });

    const persisted = await connection.collection('users').findOne({ email });
    expect(persisted?.firstName).toBe('Janet');
  });

  it('trims the values it stores', async () => {
    const response = await patchMe({
      firstName: '  Janet  ',
      lastName: '  Roe  ',
    }).expect(200);

    expect(response.body).toMatchObject({
      firstName: 'Janet',
      lastName: 'Roe',
    });
  });

  it('rejects an empty patch with 400', async () => {
    const response = await patchMe({}).expect(400);

    expect(response.body.code).toBe('VALIDATION_FAILED');
    expect(response.body.details).toContainEqual(
      expect.objectContaining({ rule: 'notEmptyPatch' }),
    );
  });

  it('rejects a blank name with 400 and names the field', async () => {
    const response = await patchMe({ firstName: '   ' }).expect(400);

    expect(response.body.details).toContainEqual(
      expect.objectContaining({ field: 'firstName' }),
    );
  });

  it('ignores fields the owner may not set on their own', async () => {
    const response = await patchMe({
      firstName: 'Janet',
      role: 'admin',
      email: 'someone.else@example.com',
      emailVerified: true,
    }).expect(200);

    expect(response.body).toMatchObject({
      role: 'user',
      email,
      emailVerified: false,
    });
  });

  it('rejects an unauthenticated caller with 401', async () => {
    await request(app.getHttpServer())
      .patch('/users/me')
      .send({ firstName: 'Janet' })
      .expect(401);
  });
});
