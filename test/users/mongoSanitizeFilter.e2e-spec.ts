import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module.js';

describe('Mongo filter sanitization (e2e)', () => {
  let app: INestApplication<App>;
  let connection: Connection;

  const email = 'sanitize.jane@example.com';

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    connection = app.get<Connection>(getConnectionToken());
    await connection.collection('users').deleteMany({ email });

    await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({
        email,
        firstName: 'Jane',
        lastName: 'Doe',
        password: 'Secret123',
      })
      .expect(201);
  });

  afterEach(async () => {
    await app.close();
  });

  it('neutralizes $-operators in query filters even below the DTO layer', async () => {
    const users = connection.model('User');

    // Without sanitizeFilter this operator filter would match every user in the collection.
    // With it, the operator is wrapped in $eq and fails to cast to the string path — the
    // query throws instead of matching anything.
    await expect(users.findOne({ email: { $gt: '' } }).lean()).rejects.toThrow(
      /Cast to string failed/,
    );

    // A legitimate equality filter still works.
    const legit = await users.findOne({ email }).lean();
    expect(legit).not.toBeNull();
  });
});
