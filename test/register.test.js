import test from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import User from "../src/models/User.js";
import { register } from "../src/controllers/authController.js";

const response = () => ({
  statusCode: 200,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

test("registration creates an account and session without a signup code", async (t) => {
  process.env.JWT_SECRET = "isolated-registration-test-secret";
  process.env.SIGNUP_CODE = "previous-code-no-longer-required";
  const input = { name: "Test Owner", email: "owner@example.com", password: "test-password" };
  t.mock.method(User, "findOne", async () => null);
  const create = t.mock.method(User, "create", async data => ({
    ...data, _id: "507f1f77bcf86cd799439011", role: "Admin",
  }));
  const res = response();
  await register({ body: input }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(create.mock.callCount(), 1);
  assert.equal(res.body.user.email, input.email);
  assert.equal(jwt.verify(res.body.token, process.env.JWT_SECRET).id, res.body.user.id);
  assert.equal(res.body.user.password, undefined);
});

test("registration still rejects missing account details before writing to the database", async (t) => {
  const create = t.mock.method(User, "create", async () => { throw new Error("unexpected write"); });
  const res = response();
  await register({ body: { name: "Test Owner" } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(create.mock.callCount(), 0);
});

test("registration still rejects an existing email without creating another user", async (t) => {
  t.mock.method(User, "findOne", async () => ({ _id: "existing-user" }));
  const create = t.mock.method(User, "create", async () => { throw new Error("unexpected write"); });
  const res = response();
  await register({ body: { name: "Test Owner", email: "owner@example.com", password: "test-password" } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, "User already exists");
  assert.equal(create.mock.callCount(), 0);
});

test("registration normalizes names and emails before duplicate lookup and storage", async (t) => {
  process.env.JWT_SECRET = "isolated-registration-test-secret";
  const find = t.mock.method(User, "findOne", async () => null);
  const create = t.mock.method(User, "create", async data => ({ ...data, _id: "507f1f77bcf86cd799439011", role: "Shop Owner" }));
  const res = response();
  await register({ body: { name: " Owner ", email: " OWNER@EXAMPLE.COM ", password: "test-password" } }, res);
  assert.equal(res.statusCode, 201);
  assert.deepEqual(find.mock.calls[0].arguments[0], { email: "owner@example.com" });
  assert.equal(create.mock.calls[0].arguments[0].name, "Owner");
  assert.equal(create.mock.calls[0].arguments[0].email, "owner@example.com");
});
