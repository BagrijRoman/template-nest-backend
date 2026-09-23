import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppException, ErrorCode } from '../common/errors/index.js';
import { CredentialsService } from './credentials.service.js';
import { User } from './entities/index.js';
import { UsersService } from './users.service.js';

const MONGO_DUPLICATE_KEY_ERROR_CODE = 11000;

const createUserDto = { email: 'jane@example.com', firstName: 'Jane', lastName: 'Doe', password: 'Secret123' };

const leanUser = (overrides: Record<string, unknown> = {}) => ({
  _id: new Types.ObjectId(),
  email: 'jane@example.com',
  firstName: 'Jane',
  lastName: 'Doe',
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
    deleteOne: vi.fn(),
    exists: vi.fn(),
    findById: vi.fn(),
    findByIdAndUpdate: vi.fn(),
    findOne: vi.fn(),
  };
  const credentialsService = { assertNotBreached: vi.fn(), createPassword: vi.fn() };

  beforeEach(async () => {
    vi.resetAllMocks();
    userModel.exists.mockResolvedValue(null);
    credentialsService.assertNotBreached.mockResolvedValue(undefined);
    credentialsService.createPassword.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getModelToken(User.name), useValue: userModel },
        { provide: CredentialsService, useValue: credentialsService },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('creates the user without any secret and stores the password as a credential', async () => {
    const doc = leanUser();
    userModel.create.mockResolvedValue({ id: doc._id.toString(), toObject: () => doc });

    const user = await service.create(createUserDto);

    expect(user).toEqual({
      id: doc._id.toString(),
      email: 'jane@example.com',
      firstName: 'Jane',
      lastName: 'Doe',
      emailVerified: false,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    });
    expect(userModel.create).toHaveBeenCalledWith({ email: 'jane@example.com', firstName: 'Jane', lastName: 'Doe' });
    expect(credentialsService.createPassword).toHaveBeenCalledWith(doc._id.toString(), 'Secret123');
  });

  it('rejects an email that is already in use without attempting the insert', async () => {
    userModel.exists.mockResolvedValue({ _id: new Types.ObjectId() });

    await expect(service.create(createUserDto)).rejects.toMatchObject({
      code: ErrorCode.EmailTaken,
      details: [{ field: 'email', rule: 'unique' }],
    });
    expect(userModel.create).not.toHaveBeenCalled();
    expect(credentialsService.createPassword).not.toHaveBeenCalled();
  });

  it('rejects a duplicate email that slips past the check into the unique index', async () => {
    userModel.create.mockRejectedValue({ code: MONGO_DUPLICATE_KEY_ERROR_CODE });

    await expect(service.create(createUserDto)).rejects.toMatchObject({
      code: ErrorCode.EmailTaken,
      details: [{ field: 'email', rule: 'unique' }],
    });
    expect(credentialsService.createPassword).not.toHaveBeenCalled();
  });

  it('screens the password before creating anything', async () => {
    credentialsService.assertNotBreached.mockRejectedValue(
      AppException.forField(400, ErrorCode.BreachedPassword, 'password', 'notBreached', 'breached'),
    );

    await expect(service.create(createUserDto)).rejects.toMatchObject({ code: ErrorCode.BreachedPassword });
    expect(credentialsService.assertNotBreached).toHaveBeenCalledWith('Secret123', 'password', {
      email: 'jane@example.com',
    });
    expect(userModel.create).not.toHaveBeenCalled();
  });

  it('deletes the just-created user when the credential insert fails, and rethrows', async () => {
    const doc = leanUser();
    const failure = new Error('credentials collection unavailable');
    userModel.create.mockResolvedValue({ id: doc._id.toString(), toObject: () => doc });
    credentialsService.createPassword.mockRejectedValue(failure);

    await expect(service.create(createUserDto)).rejects.toBe(failure);
    expect(userModel.deleteOne).toHaveBeenCalledWith({ _id: doc._id.toString() });
  });

  it('finds a user by id and exposes the Mongo id as a string', async () => {
    const doc = leanUser();
    userModel.findById.mockReturnValue(withLean(doc));

    const user = await service.findById(doc._id.toString());

    expect(user?.id).toBe(doc._id.toString());
    expect(user).not.toHaveProperty('_id');
  });

  it('returns null for a missing id and for a malformed id without querying', async () => {
    userModel.findById.mockReturnValue(withLean(null));
    expect(await service.findById(new Types.ObjectId().toString())).toBeNull();

    expect(await service.findById('not-an-object-id')).toBeNull();
    expect(userModel.findById).toHaveBeenCalledTimes(1);
  });

  it('finds a user by email', async () => {
    const doc = leanUser();
    userModel.findOne.mockReturnValue(withLean(doc));

    expect((await service.findByEmail('jane@example.com'))?.id).toBe(doc._id.toString());
    expect(userModel.findOne).toHaveBeenCalledWith({ email: 'jane@example.com' });

    userModel.findOne.mockReturnValue(withLean(null));
    expect(await service.findByEmail('missing@example.com')).toBeNull();
  });

  it('marks the email verified', async () => {
    const doc = leanUser({ emailVerified: true });
    userModel.findByIdAndUpdate.mockReturnValue(withLean(doc));

    const user = await service.markEmailVerified(doc._id.toString());

    expect(userModel.findByIdAndUpdate.mock.calls[0][1]).toEqual({ emailVerified: true });
    expect(user?.emailVerified).toBe(true);
  });

  it('treats documents created before the emailVerified flag as unverified', async () => {
    userModel.findById.mockReturnValue(withLean(leanUser({ emailVerified: undefined })));

    expect((await service.findById(new Types.ObjectId().toString()))?.emailVerified).toBe(false);
  });
});
