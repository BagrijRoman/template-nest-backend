import { ConflictException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
    findOne: vi.fn(),
  };

  beforeEach(async () => {
    vi.resetAllMocks();
    // resetAllMocks also wipes the module spy's pass-through implementation — restore it.
    const original = await vi.importActual<typeof import('./password.util.js')>('./password.util.js');
    vi.mocked(verifyPasswordHash).mockImplementation(original.verifyPasswordHash);
    userModel.exists.mockResolvedValue(null);

    const module: TestingModule = await Test.createTestingModule({
      providers: [UsersService, { provide: getModelToken(User.name), useValue: userModel }],
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
    ).rejects.toThrow(ConflictException);
    expect(userModel.create).not.toHaveBeenCalled();
  });

  it('rejects a duplicate email that slips past the check into the unique index', async () => {
    userModel.create.mockRejectedValue({ code: MONGO_DUPLICATE_KEY_ERROR_CODE });

    await expect(
      service.create({ email: 'jane@example.com', firstName: 'Jane', lastName: 'Doe', password: 'secret123' }),
    ).rejects.toThrow(ConflictException);
  });

  it('verifies correct credentials and rejects wrong ones', async () => {
    userModel.findOne.mockImplementation(() => withLean(leanUser()));

    expect((await service.verifyPassword('jane@example.com', 'secret123'))?.email).toBe('jane@example.com');
    expect(await service.verifyPassword('jane@example.com', 'wrong')).toBeNull();

    userModel.findOne.mockImplementation(() => withLean(null));
    expect(await service.verifyPassword('missing@example.com', 'secret123')).toBeNull();
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
