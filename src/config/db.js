import mongoose from "mongoose";

let connecting;
export default async function connectDB() {
  if (mongoose.connection.readyState === 1) return mongoose;
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required");
  if (!connecting) {
    connecting = mongoose.connect(process.env.MONGO_URI, {
      maxPoolSize: 5,
      minPoolSize: 0,
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
    }).finally(() => { connecting = undefined; });
  }
  return connecting;
}
