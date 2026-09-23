import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Session } from './entities/index.js';
import { SessionsService } from './sessions.service.js';

const USER_ID = '507f1f77bcf86cd799439011';
const CLIENT = { userAgent: 'Mozilla/5.0', ip: '203.0.113.10' };

const leanSession = (overrides: Record<string, unknown> = {}) => ({
  _id: new Types.ObjectId(),
  userId: USER_ID,
  ...CLIENT,
  lastSeenAt: new Date(),
  expiresAt: new Date(Date.now() + 60_000),
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe('SessionsService', () => {
  let service: SessionsService;

  const sessionModel = {
    create: vi.fn(),
    deleteMany: vi.fn(),
    deleteOne: vi.fn(),
    exists: vi.fn(),
    find: vi.fn(),
    updateOne: vi.fn(),
  };

  beforeEach(async () => {
    vi.resetAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [SessionsService, { provide: getModelToken(Session.name), useValue: sessionModel }],
    }).compile();

    service = module.get<SessionsService>(SessionsService);
  });

  it('opens a session recording the device, and returns its id', async () => {
    const created = leanSession();
    sessionModel.create.mockResolvedValue(created);

    expect(await service.start(USER_ID, CLIENT)).toBe(created._id.toString());

    const persisted = sessionModel.create.mock.calls[0][0];
    expect(persisted).toMatchObject({ userId: USER_ID, ...CLIENT });
    // Short-lived until the first refresh token is stored, so a half-finished sign-in leaves nothing behind.
    expect(persisted.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(persisted.expiresAt.getTime()).toBeLessThan(Date.now() + 120_000);
  });

  it('opens a session even when the client tells us nothing about itself', async () => {
    sessionModel.create.mockResolvedValue(leanSession());

    await service.start(USER_ID, {});

    expect(sessionModel.create.mock.calls[0][0]).toMatchObject({ userId: USER_ID });
  });

  it('keeps the session alive for exactly as long as its newest token, refreshing the device info', async () => {
    const expiresAt = new Date(Date.now() + 30 * 24 * 3_600_000);
    const sessionId = new Types.ObjectId().toString();

    await service.touch(sessionId, CLIENT, expiresAt);

    const [filter, update] = sessionModel.updateOne.mock.calls[0];
    expect(filter).toEqual({ _id: sessionId });
    expect(update).toMatchObject({ ...CLIENT, expiresAt });
    expect(update.lastSeenAt).toBeInstanceOf(Date);
  });

  it('lists the devices of one user, most recently used first', async () => {
    const docs = [leanSession(), leanSession({ userAgent: undefined, ip: undefined })];
    const query = { sort: vi.fn().mockReturnThis(), lean: vi.fn().mockResolvedValue(docs) };
    sessionModel.find.mockReturnValue(query);

    const sessions = await service.findForUser(USER_ID);

    expect(sessionModel.find).toHaveBeenCalledWith({ userId: USER_ID });
    expect(query.sort).toHaveBeenCalledWith({ lastSeenAt: -1, _id: -1 });
    expect(sessions.map((session) => session.id)).toEqual(docs.map((doc) => doc._id.toString()));
    expect(sessions[0]).toMatchObject(CLIENT);
    // Nothing internal leaks into the device list.
    expect(sessions[0]).not.toHaveProperty('expiresAt');
    expect(sessions[0]).not.toHaveProperty('userId');
  });

  it('confirms ownership only for a session of that user', async () => {
    const sessionId = new Types.ObjectId().toString();
    sessionModel.exists.mockResolvedValue({ _id: sessionId });
    expect(await service.belongsToUser(sessionId, USER_ID)).toBe(true);
    expect(sessionModel.exists).toHaveBeenCalledWith({ _id: sessionId, userId: USER_ID });

    sessionModel.exists.mockResolvedValue(null);
    expect(await service.belongsToUser(sessionId, USER_ID)).toBe(false);
  });

  it('treats a malformed session id as not found, without querying', async () => {
    expect(await service.belongsToUser('not-an-object-id', USER_ID)).toBe(false);
    expect(sessionModel.exists).not.toHaveBeenCalled();
  });

  it('deletes one session and every session of a user', async () => {
    const sessionId = new Types.ObjectId().toString();

    await service.delete(sessionId);
    expect(sessionModel.deleteOne).toHaveBeenCalledWith({ _id: sessionId });

    await service.deleteAllForUser(USER_ID);
    expect(sessionModel.deleteMany).toHaveBeenCalledWith({ userId: USER_ID });
  });
});
