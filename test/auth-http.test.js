import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import User from "../src/models/User.js";

process.env.MONGO_URI = "mongodb://unused.invalid/isolated-test";
process.env.JWT_SECRET = "isolated-http-test-secret";
process.env.NODE_ENV = "production";
process.env.NETLIFY = "true";
const { handler } = await import("../netlify/functions/api.mjs");
const origins = ["http://localhost:5177", "https://musiramuloan.netlify.app"];
const invoke = (path, { origin = origins[0], method = "POST", body = {}, ip = "192.0.2.10" } = {}) => handler({
  httpMethod: method, path,
  headers: { host: "api.example.com", origin, "content-type": "application/json" },
  queryStringParameters: {}, body: body == null ? null : (typeof body === "string" ? body : JSON.stringify(body)),
  isBase64Encoded: false, requestContext: { identity: { sourceIp: ip } },
}, {});
const connect = t => t.mock.method(mongoose, "connect", async () => mongoose);

for (const origin of origins) {
  test(`credential and duplicate-account errors keep CORS headers for ${origin}`, async (t) => {
    connect(t);
    const find = t.mock.method(User, "findOne", async () => null);
    let res = await invoke("/api/auth/login", { origin, body: { identifier: "owner@example.com", password: "wrong-password" } });
    assert.equal(res.statusCode, 401);
    assert.equal(res.headers["access-control-allow-origin"], origin);
    assert.equal(JSON.parse(res.body).message, "Invalid credentials");
    find.mock.mockImplementation(async () => ({ _id: "existing-user" }));
    res = await invoke("/api/auth/register", { origin, body: { name: "Owner", email: "owner@example.com", password: "test-password" } });
    assert.equal(res.statusCode, 400);
    assert.equal(res.headers["access-control-allow-origin"], origin);
    assert.equal(JSON.parse(res.body).message, "User already exists");
  });
}

test("unexpected database errors become JSON responses with CORS instead of rejected invocations", async (t) => {
  connect(t);
  t.mock.method(User, "findOne", async () => { throw new Error("private database failure details"); });
  const res = await invoke("/api/auth/register", { body: { name: "Owner", email: "owner@example.com", password: "test-password" } });
  assert.equal(res.statusCode, 500);
  assert.equal(res.headers["access-control-allow-origin"], origins[0]);
  assert.equal(JSON.parse(res.body).message, "Server error. Please try again.");
  assert.ok(!res.body.includes("private database"));
});

test("missing JWT configuration cannot create an account before failing", async (t) => {
  connect(t);
  const savedSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "";
  t.after(() => { process.env.JWT_SECRET = savedSecret; });
  const create = t.mock.method(User, "create", async () => { throw new Error("unexpected write"); });
  const res = await invoke("/api/auth/register", { body: { name: "Owner", email: "owner@example.com", password: "test-password" } });
  assert.equal(res.statusCode, 503);
  assert.equal(res.headers["access-control-allow-origin"], origins[0]);
  assert.match(JSON.parse(res.body).message, /Authentication is not configured/);
  assert.equal(create.mock.callCount(), 0);
});

test("login normalizes email and verifies the stored password", async (t) => {
  connect(t);
  const user = new User({ name: "Owner", email: "owner@example.com", password: await bcrypt.hash("test-password", 4) });
  const find = t.mock.method(User, "findOne", async () => user);
  const res = await invoke("/api/auth/login", { body: { identifier: "  OWNER@EXAMPLE.COM ", password: "test-password" } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(find.mock.calls[0].arguments[0], { email: "owner@example.com" });
  const data = JSON.parse(res.body);
  assert.ok(data.token);
  assert.equal(data.user.email, user.email);
  assert.equal(data.user.password, undefined);
});

test("malformed JSON retains CORS headers", async () => {
  const res = await invoke("/api/auth/register", { body: "{invalid-json" });
  assert.equal(res.statusCode, 400);
  assert.equal(res.headers["access-control-allow-origin"], origins[0]);
});

test("rate-limited responses retain CORS and do not block preflight", async () => {
  let res;
  for (let count = 0; count < 301; count++) {
    res = await invoke("/", { method: "GET", body: null, ip: "192.0.2.77" });
    if (count < 300) assert.equal(res.statusCode, 200);
  }
  assert.equal(res.statusCode, 429);
  assert.equal(res.headers["access-control-allow-origin"], origins[0]);
  assert.match(JSON.parse(res.body).message, /Too many requests/);
  res = await invoke("/api/auth/login", { method: "OPTIONS", ip: "192.0.2.77" });
  assert.equal(res.statusCode, 204);
  assert.equal(res.headers["access-control-allow-origin"], origins[0]);
});
