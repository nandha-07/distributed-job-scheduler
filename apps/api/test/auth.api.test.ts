/**
 * API integration tests via supertest (in-memory HTTP against createApp()).
 * Requires the local database; skips cleanly without it.
 */
import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { pool } from "@jobs/db";
import { createApp } from "../src/app.js";

const canConnect = await pool.query("SELECT 1").then(() => true, () => false);
const d = describe.skipIf(!canConnect);
const app = createApp();
const email = `test-${Math.random().toString(36).slice(2, 8)}@example.com`;
const password = "TestPassword123";
let token = "";

afterAll(async () => {
  if (canConnect) {
    // Remove the test user's org (cascade) and the user itself.
    await pool.query(
      `DELETE FROM organizations o USING organization_members m, users u
        WHERE m.organization_id = o.id AND m.user_id = u.id AND u.email = $1`, [email]);
    await pool.query("DELETE FROM users WHERE email = $1", [email]);
  }
});

d("auth API", () => {
  it("registers a new account (201) with no password in the response", async () => {
    const res = await request(app).post("/api/v1/auth/register")
      .send({ email, password, name: "Test User" });
    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toContain("password");
  });

  it("rejects a duplicate email (409 EMAIL_TAKEN)", async () => {
    const res = await request(app).post("/api/v1/auth/register")
      .send({ email, password, name: "Dup" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("EMAIL_TAKEN");
  });

  it("rejects wrong credentials with an unrevealing 401", async () => {
    const res = await request(app).post("/api/v1/auth/login")
      .send({ email, password: "WrongPassword1" });
    expect(res.status).toBe(401);
    expect(res.body.error.message).not.toMatch(/password is wrong|no such user/i);
  });

  it("logs in and reaches a protected route", async () => {
    const login = await request(app).post("/api/v1/auth/login").send({ email, password });
    expect(login.status).toBe(200);
    token = login.body.token;

    const me = await request(app).get("/api/v1/me")
      .set("Authorization", `Bearer ${token}`);
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(email);
  });

  it("rejects requests without a token (401) and invalid ids (400)", async () => {
    expect((await request(app).get("/api/v1/projects")).status).toBe(401);
    const bad = await request(app).post("/api/v1/queues/not-a-uuid/pause")
      .set("Authorization", `Bearer ${token}`);
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("INVALID_ID");
  });

  it("validates request bodies (400 with per-field details)", async () => {
    const res = await request(app).post("/api/v1/auth/register")
      .send({ email: "not-an-email", password: "short" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.details.length).toBeGreaterThan(0);
  });
});
