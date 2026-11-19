import crypto from "node:crypto";
import mongoose from "mongoose";
import connectDB from "../../src/config/db.js";
import { runReminderJob } from "../../src/jobs/reminders.js";

export const handler = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;
  const secret = process.env.CRON_SECRET;
  const supplied = event.headers?.["x-cron-secret"] || "";
  const providedBytes = Buffer.from(supplied);
  const secretBytes = Buffer.from(secret || "");
  if (!secret || providedBytes.length !== secretBytes.length || !crypto.timingSafeEqual(providedBytes, secretBytes)) {
    return { statusCode: 401 };
  }
  await connectDB();
  // A database lease prevents overlapping scheduled batches across function instances.
  const locks = mongoose.connection.collection("jobLocks");
  const owner = crypto.randomUUID();
  const now = new Date();
  try {
    await locks.updateOne(
      { _id: "scheduled-reminders", expiresAt: { $lte: now } },
      { $set: { owner, expiresAt: new Date(Date.now() + 16 * 60 * 1000) } },
      { upsert: true },
    );
  } catch (error) {
    if (error.code === 11000) return { statusCode: 200 }; // Existing active lease.
    throw error;
  }
  try { await runReminderJob(); }
  finally { await locks.deleteOne({ _id: "scheduled-reminders", owner }); }
  return { statusCode: 200 };
};
