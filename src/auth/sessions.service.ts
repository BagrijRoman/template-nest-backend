import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Session } from './entities/index.js';

/** What a request tells us about the device it came from; both parts are best-effort. */
export type ClientInfo = { userAgent?: string; ip?: string };

/** One row of the device list a user sees. */
export type SessionSummary = {
  id: string;
  userAgent?: string;
  ip?: string;
  lastSeenAt: Date;
  createdAt: Date;
};

// A fresh session is extended to its refresh token's expiry as soon as that token is stored; this
// only bounds the gap in between, so a half-finished sign-in cannot leave a row behind forever.
const BOOTSTRAP_TTL_MS = 60_000;

@Injectable()
export class SessionsService {
  constructor(@InjectModel(Session.name) private readonly sessionModel: Model<Session>) {}

  /** Opens a device session and returns its id, which the tokens of this session carry. */
  async start(userId: string, client: ClientInfo): Promise<string> {
    const now = new Date();
    const session = await this.sessionModel.create({
      userId,
      ...client,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + BOOTSTRAP_TTL_MS),
    });
    return session._id.toString();
  }

  /** Rotation keeps the session alive: it lives exactly as long as its newest refresh token. */
  async touch(sessionId: string, client: ClientInfo, expiresAt: Date): Promise<void> {
    await this.sessionModel.updateOne({ _id: sessionId }, { ...client, lastSeenAt: new Date(), expiresAt });
  }

  /** The caller's device list, most recently used first. */
  async findForUser(userId: string): Promise<SessionSummary[]> {
    const sessions = await this.sessionModel.find({ userId }).sort({ lastSeenAt: -1, _id: -1 }).lean();
    return sessions.map((session) => ({
      id: session._id.toString(),
      userAgent: session.userAgent,
      ip: session.ip,
      lastSeenAt: session.lastSeenAt,
      createdAt: session.createdAt,
    }));
  }

  /** Whether the session exists and belongs to this user — the ownership check before revoking one. */
  async belongsToUser(sessionId: string, userId: string): Promise<boolean> {
    // An invalid ObjectId would make Mongoose throw a CastError — treat it as "not found" instead.
    if (!Types.ObjectId.isValid(sessionId)) {
      return false;
    }
    return (await this.sessionModel.exists({ _id: sessionId, userId })) !== null;
  }

  /** Ends sessions; the refresh tokens that point at them are deleted by `RefreshTokensService`. */
  async delete(sessionId: string): Promise<void> {
    await this.sessionModel.deleteOne({ _id: sessionId });
  }

  async deleteAllForUser(userId: string): Promise<void> {
    await this.sessionModel.deleteMany({ userId });
  }
}
