import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import connectDB from "../src/config/db.js";

test("concurrent cold requests share a connection attempt and failures can retry", async (t) => {
  process.env.MONGO_URI = "mongodb://unused.invalid/test";
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const connect = t.mock.method(mongoose, "connect", () => pending);
  const first = connectDB();
  const second = connectDB();
  assert.equal(connect.mock.callCount(), 1);
  release(mongoose);
  await Promise.all([first, second]);

  connect.mock.mockImplementation(() => Promise.reject(new Error("unavailable")));
  await assert.rejects(connectDB(), /unavailable/);
  connect.mock.mockImplementation(() => Promise.resolve(mongoose));
  await connectDB();
  assert.equal(connect.mock.callCount(), 3);
});
