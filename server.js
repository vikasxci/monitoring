import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { connectDB } from "./db.js";
import { startEmbeddedMongo } from "./localdb.js";
import deviceRoutes from "./routes/devices.js";
import ingestRoutes from "./routes/ingest.js";
import dashboardRoutes from "./routes/dashboard.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

app.get("/api/health", (req, res) => res.json({ ok: true, t: Date.now() }));

app.use("/api", deviceRoutes); // /api/admin/login, /api/devices/enroll
app.use("/api/ingest", ingestRoutes); // device -> server
app.use("/api/dashboard", dashboardRoutes); // admin -> server

// Serve the admin dashboard (static SPA).
app.use(express.static(path.join(__dirname, "..", "public")));

const PORT = process.env.PORT || 4000;

async function start() {
  let uri = process.env.MONGODB_URI;
  if (!uri || !uri.trim()) {
    // No MongoDB configured -> spin up a local embedded one (zero setup).
    console.log("[db] MONGODB_URI not set — using embedded MongoDB for local testing.");
    console.log("[db] (set MONGODB_URI in .env to use your own MongoDB or Atlas)");
    uri = await startEmbeddedMongo();
  }
  await connectDB(uri);
  app.listen(PORT, () => {
    console.log(`[server] listening on http://localhost:${PORT}`);
    console.log(`[server] dashboard:  http://localhost:${PORT}/`);
  });
}

start().catch((err) => {
  console.error("[server] failed to start:", err.message);
  process.exit(1);
});
