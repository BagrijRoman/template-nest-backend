import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCode } from '../common/errors/index.js';
import { SecurityEventsService } from '../common/securityEvents/securityEvents.service.js';
import { BreachedPasswordsService } from './breachedPasswords.service.js';
import { User } from './entities/index.js';
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPasswordHash } from './password.util.js';
import { UsersService } from './users.service.js';

// verifyPasswordHash is wrapped in a spy (behavior unchanged) so tests can observe the
// dummy verification that equalizes timing for unknown emails.
vi.mock('./password.util.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('./password.util.js')>();
  return { ...original, verifyPasswordHash: vi.fn(original.verifyPasswordHash) };
});

const MONGO_DUPLICATE_KEY_ERROR_CODE = 11000;

let storedPasswordHash: string;
beforeAll(async () => {
  storedPasswordHash = await hashPassword('secret123');
});

const leanUser = (overrides: Record<string, unknown> = {}) => ({
  _id: new Types.ObjectId(),
  email: 'jane@example.com',
  firstName: 'Jane',
  lastName: 'Doe',
  passwordHash: storedPasswordHash,
  emailVerified: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const withLean = <T>(value: T) => ({ lean: () => Promise.resolve(value) });

describe('UsersService', () => {
  let service: UsersService;

  const userModel = {
    create: vi.fn(),
    exists: vi.fn(),
    findById: vi.fn(),
    findByIdAndUpdate: vi.fn(),
    findOne: vi.fn(),
  };

  const breachedPasswordsService = { isBreached: vi.fn() };
  const securityEvents = { record: vi.fn() };

  beforeEach(async () => {
    vi.resetAllMocks();
    // resetAllMocks also wipes the module spy's pass-through implementation — restore it.
    const original = await vi.importActual<typeof import('./password.util.js')>('./password.util.js');
    vi.mocked(verifyPasswordHash).mockImplementation(original.verifyPasswordHash);
    userModel.exists.mockResolvedValue(null);
    breachedPasswordsService.isBreached.mockResolvedValue(false);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getModelToken(User.name), useValue: userModel },
        { provide: BreachedPasswordsService, useValue: breachedPasswordsService },
        { provide: SecurityEventsService, useValue: securityEvents },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('creates a user and exposes the Mongo id as a string', async () => {
    const doc = leanUser();
    userModel.create.mockResolvedValue({ id: doc._id.toString(), toObject: () => doc });

    const user = await service.create({
      email: 'jane@example.com',
      firstName: 'Jane',
      lastName: 'Doe',
      password: 'secret123',
    });

    expect(user.id).toBe(doc._id.toString());
    expect(user.email).toBe('jane@example.com');
    expect(user.firstName).toBe('Jane');
    expect(user.lastName).toBe('Doe');
    expect(user).not.toHaveProperty('_id');
    expect(user).not.toHaveProperty('passwordHash');
  });

  it('hashes the password before persisting it', async () => {
    const doc = leanUser();
    userModel.create.mockResolvedValue({ id: doc._id.toString(), toObject: () => doc });

    await service.create({ email: 'jane@example.com', firstName: 'Jane', lastName: 'Doe', password: 'secret123' });

    const persisted = userModel.create.mock.calls[0][0];
    expect(persisted.password).toBeUndefined();
    expect(await verifyPasswordHash('secret123', persisted.passwordHash)).toBe(true);
  });

  it('rejects an email that is already in use without attempting the insert', async () => {
    userModel.exists.mockResolvedValue({ _id: new Types.ObjectId() });

    await expect(
      service.create({ email: 'jane@example.com', firstName: 'Jane', lastName: 'Doe', password: 'secret123' }),
    ).rejects.toMatchObject({ code: ErrorCode.EmailTaken, details: [{ field: 'email', rule: 'unique' }] });
    expect(userModel.create).not.toHaveBeenCalled();
  });

  it('rejects a duplicate email that slips past the check into the unique index', async () => {
    userModel.create.mockRejectedValue({ code: MONGO_DUPLICATE_KEY_ERROR_CODE });

    await expect(
      service.create({ email: 'jane@example.com', firstName: 'Jane', lastName: 'Doe', password: 'secret123' }),
    ).rejects.toMatchObject({ code: ErrorCode.EmailTaken, details: [{ field: 'email', rule: 'unique' }] });
  });

  it('verifies correct credentials and rejects wrong ones', async () => {
    userModel.findOne.mockImplementation(() => withLean(leanUser()));

    expect((await service.verifyPassword('jane@example.com', 'secret123'))?.email).toBe('jane@example.com');
    expect(await service.verifyPassword('jane@example.com', 'wrong')).toBeNull();

    userModel.findOne.mockImplementation(() => withLean(null));
    expect(await service.verifyPassword('missing@example.com', 'secret123')).toBeNull();
  });

  it('finds a user by id and returns the safe shape', async () => {
    const doc = leanUser();
    userModel.findById.mockReturnValue(withLean(doc));

    const user = await service.findById(doc._id.toString());

    expect(user?.id).toBe(doc._id.toString());
    expect(user).not.toHaveProperty('passwordHash');
  });

  it('returns null for a missing id and for a malformed id without querying', async () => {
    userModel.findById.mockReturnValue(withLean(null));
    expect(await service.findById(new Types.ObjectId().toString())).toBeNull();

    expect(await service.findById('not-an-object-id')).toBeNull();
    expect(userModel.findById).toHaveBeenCalledTimes(1);
  });

  it('rejects a breached password at sign-up before creating anything', async () => {
    breachedPasswordsService.isBreached.mockResolvedValue(true);

    await expect(
      service.create({ email: 'jane@example.com', firstName: 'Jane', lastName: 'Doe', password: 'secret123' }),
    ).rejects.toMatchObject({ code: ErrorCode.BreachedPassword });
    expect(userModel.create).not.toHaveBeenCalled();
  });

  it('rejects a breached new password on password change without writing', async () => {
    const doc = leanUser();
    userModel.findById.mockReturnValue(withLean(doc));
    breachedPasswordsService.isBreached.mockResolvedValue(true);

    await expect(service.updatePassword(doc._id.toString(), 'secret123', 'Breached123')).rejects.toMatchObject({
      code: ErrorCode.BreachedPassword,
      details: [{ field: 'newPassword' }],
    });
    expect(userModel.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it('updates the password after verifying the current one, storing a new hash', async () => {
    const doc = leanUser();
    userModel.findById.mockReturnValue(withLean(doc));
    userModel.findByIdAndUpdate.mockReturnValue(withLean({ ...doc, passwordHash: 'replaced' }));

    const user = await service.updatePassword(doc._id.toString(), 'secret123', 'NewSecret123');

    expect(user?.id).toBe(doc._id.toString());
    expect(user).not.toHaveProperty('passwordHash');
    const [, update] = userModel.findByIdAndUpdate.mock.calls[0];
    expect(await verifyPasswordHash('NewSecret123', update.passwordHash)).toBe(true);
  });

  it('rejects a password update when the current password is wrong, without writing anything', async () => {
    userModel.findById.mockReturnValue(withLean(leanUser()));

    expect(await service.updatePassword(new Types.ObjectId().toString(), 'wrong', 'NewSecret123')).toBeNull();
    expect(userModel.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it('marks the email verified and returns the safe shape', async () => {
    const doc = leanUser({ emailVerified: true });
    userModel.findByIdAndUpdate.mockReturnValue(withLean(doc));

    const user = await service.markEmailVerified(doc._id.toString());

    expect(userModel.findByIdAndUpdate.mock.calls[0][1]).toEqual({ emailVerified: true });
    expect(user?.emailVerified).toBe(true);
    expect(user).not.toHaveProperty('passwordHash');
  });

  it('runs a dummy hash verification for unknown emails so timing does not reveal account existence', async () => {
    userModel.findOne.mockImplementation(() => withLean(null));

    await service.verifyPassword('missing@example.com', 'secret123');

    expect(verifyPasswordHash).toHaveBeenCalledExactlyOnceWith('secret123', DUMMY_PASSWORD_HASH);
  });

  it('never exposes the password hash', async () => {
    const doc = leanUser();
    userModel.create.mockResolvedValue({ id: doc._id.toString(), toObject: () => doc });
    userModel.findOne.mockReturnValue(withLean(doc));

    const created = await service.create({
      email: 'jane@example.com',
      firstName: 'Jane',
      lastName: 'Doe',
      password: 'secret123',
    });

    expect(created).not.toHaveProperty('passwordHash');
    expect(await service.verifyPassword('jane@example.com', 'secret123')).not.toHaveProperty('passwordHash');
  });
});
