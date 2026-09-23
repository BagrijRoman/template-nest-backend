import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException, ErrorCode } from '../common/errors/index.js';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SecurityEvent, SecurityEventsService } from '../common/securityEvents/securityEvents.service.js';
import { BreachedPasswordsService } from './breachedPasswords.service.js';
import { Credential, CredentialType } from './entities/index.js';
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPasswordHash } from './password.util.js';

const BREACHED_PASSWORD_MESSAGE = 'This password has appeared in a known data breach — please choose a different one';

const breachedPasswordException = (field: string): AppException =>
  AppException.forField(
    HttpStatus.BAD_REQUEST,
    ErrorCode.BreachedPassword,
    field,
    'notBreached',
    BREACHED_PASSWORD_MESSAGE,
  );

/** Who the rejected password belonged to, for the security event: the account, or the email at sign-up. */
type BreachContext = { userId?: string; email?: string };

/**
 * The only owner of secret material: password hashes live in the `credentials` collection, one
 * document per user and credential type. Nothing here ever returns a hash — callers get booleans.
 */
@Injectable()
export class CredentialsService {
  constructor(
    @InjectModel(Credential.name) private readonly credentialModel: Model<Credential>,
    private readonly breachedPasswordsService: BreachedPasswordsService,
    private readonly securityEvents: SecurityEventsService,
  ) {}

  /** Screens a candidate password before anything is written; `field` names it in the 400 details. */
  async assertNotBreached(password: string, field: string, context: BreachContext): Promise<void> {
    if (await this.breachedPasswordsService.isBreached(password)) {
      this.securityEvents.record(SecurityEvent.BreachedPasswordRejected, context);
      throw breachedPasswordException(field);
    }
  }

  /** Stores the password credential of a just-created user; the caller has screened the password already. */
  async createPassword(userId: string, password: string): Promise<void> {
    await this.credentialModel.create({
      userId,
      type: CredentialType.Password,
      secretHash: await hashPassword(password),
    });
  }

  /**
   * Checks a password without ever exposing the stored hash. A `null` user (unknown email) still
   * pays the full scrypt cost against a dummy hash, so response timing does not reveal whether an
   * account exists.
   */
  async verifyPassword(userId: string | null, password: string): Promise<boolean> {
    const credential = userId === null ? null : await this.findPassword(userId);
    const isValid = await verifyPasswordHash(password, credential?.secretHash ?? DUMMY_PASSWORD_HASH);
    return credential !== null && isValid;
  }

  /**
   * Verifies the current password, then replaces it. False when the current password is wrong or
   * the account has no password credential — indistinguishable on purpose.
   */
  async updatePassword(userId: string, currentPassword: string, newPassword: string): Promise<boolean> {
    if (!(await this.verifyPassword(userId, currentPassword))) {
      return false;
    }
    await this.replacePassword(userId, newPassword);
    return true;
  }

  /**
   * Sets a new password WITHOUT any proof of the current one — only for flows that established
   * ownership another way (change-password verifies the current password first; the reset flow
   * proves control of the email). Creates the credential when the account has none yet.
   * Never expose this through a controller directly.
   */
  async replacePassword(userId: string, newPassword: string): Promise<void> {
    await this.assertNotBreached(newPassword, 'newPassword', { userId });
    await this.credentialModel.updateOne(
      { userId, type: CredentialType.Password },
      { secretHash: await hashPassword(newPassword) },
      { upsert: true },
    );
  }

  /** Every credential of a deleted account: nothing here outlives its owner. */
  async deleteForUser(userId: string): Promise<void> {
    await this.credentialModel.deleteMany({ userId });
  }

  private findPassword(userId: string) {
    return this.credentialModel.findOne({ userId, type: CredentialType.Password }).lean();
  }
}
