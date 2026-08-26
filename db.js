import mongoose from "mongoose";

export async function connectDB(uri) {
  mongoose.set("strictQuery", true);
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 8000,
  });
  console.log("[db] connected to MongoDB");
  return mongoose.connection;
}
