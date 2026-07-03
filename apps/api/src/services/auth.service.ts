/**
 * Auth business logic. No HTTP here (no req/res), no SQL here (repos only).
 * This layer is what unit tests target.
 */
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { SignOptions } from "jsonwebtoken";
import { config } from "@jobs/config";
import {
  usersRepo,
  orgsRepo,
  withTransaction,
  type PublicUser,
} from "@jobs/db";
import { conflict, unauthorized } from "../lib/errors.js";

// Cost factor 10 ≈ 100ms per hash: slow enough to hurt brute-force,
// fast enough not to hurt login UX.
const BCRYPT_ROUNDS = 10;

function signToken(userId: string): string {
  return jwt.sign({ sub: userId }, config.JWT_SECRET, {
    expiresIn: config.JWT_EXPIRES_IN,
  } as SignOptions);
}

export async function register(params: {
  email: string;
  password: string;
  name: string;
}): Promise<{ user: PublicUser; token: string }> {
  const existing = await usersRepo.findByEmail(params.email);
  if (existing) {
    throw conflict("EMAIL_TAKEN", "An account with this email already exists");
  }

  const passwordHash = await bcrypt.hash(params.password, BCRYPT_ROUNDS);

  // User + personal org + owner membership: one transaction, all-or-nothing.
  const user = await withTransaction(async (tx) => {
    const created = await usersRepo.create(tx, {
      email: params.email,
      passwordHash,
      name: params.name,
    });
    const org = await orgsRepo.create(tx, {
      name: `${params.name}'s workspace`,
    });
    await orgsRepo.addMember(tx, {
      organizationId: org.id,
      userId: created.id,
      role: "owner",
    });
    return created;
  });

  return { user: usersRepo.toPublicUser(user), token: signToken(user.id) };
}

export async function login(params: {
  email: string;
  password: string;
}): Promise<{ user: PublicUser; token: string }> {
  const user = await usersRepo.findByEmail(params.email);
  // Deliberately identical error for "no such user" and "wrong password":
  // never reveal which emails have accounts (account enumeration).
  if (!user) throw unauthorized("Invalid email or password");

  const ok = await bcrypt.compare(params.password, user.password_hash);
  if (!ok) throw unauthorized("Invalid email or password");

  return { user: usersRepo.toPublicUser(user), token: signToken(user.id) };
}

export async function getMe(userId: string): Promise<PublicUser> {
  const user = await usersRepo.findById(userId);
  if (!user) throw unauthorized("Account no longer exists");
  return usersRepo.toPublicUser(user);
}
