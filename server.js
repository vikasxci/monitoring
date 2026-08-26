import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { connectDB } from "./db.js";
import deviceRoutes from "./routes/devices.js";
import ingestRoutes from "./routes/ingest.js";
import dashboardRoutes from "./routes/dashboard.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env from the project root no matter where node is launched from.
// (Running `node server.js` from inside src/ would otherwise miss it.) On hosts
// like Render there is no .env file — the vars come from the dashboard — and
// these calls simply no-op. dotenv never overrides vars already in the environment.
for (const envPath of [path.join(__dirname, "..", ".env"), path.join(__dirname, ".env")]) {
  dotenv.config({ path: envPath });
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

app.get("/api/health", (req, res) => res.json({ ok: true, t: Date.now() }));

app.use("/api", deviceRoutes); // /api/admin/login, /api/devices/enroll
app.use("/api/ingest", ingestRoutes); // device -> server
app.use("/api/dashboard", dashboardRoutes); // admin -> server

// Serve the admin dashboard.
// Locally the files live in public/. When deployed via GitHub's web uploader
// (which flattens folders) the dashboard is a single self-contained index.html
// uploaded next to server.js. Support both.
const publicDirCandidates = [
  path.join(__dirname, "..", "public"),
  path.join(__dirname, "public"),
];
const publicDir = publicDirCandidates.find((d) => fs.existsSync(d));
if (publicDir) app.use(express.static(publicDir));

// Locate the dashboard's index.html across every layout.
const indexCandidates = [
  publicDir && path.join(publicDir, "index.html"),
  path.join(__dirname, "index.html"),
  path.join(__dirname, "..", "index.html"),
].filter(Boolean);
const indexHtml = indexCandidates.find((f) => fs.existsSync(f));

if (indexHtml) {
  console.log(`[server] dashboard from ${indexHtml}`);
} else {
  console.warn("[server] no dashboard index.html found — dashboard will not be served.");
  console.warn("[server] searched:");
  for (const p of indexCandidates) console.warn(`[server]   - ${p}`);
  console.warn("[server] FIX: deploy the backend/public/ folder (or set Render's Root");
  console.warn("[server]      Directory to 'backend'), then redeploy.");
}

// Serve the dashboard at "/" and let any other non-API GET fall back to it.
// When the dashboard files are missing on the host, return a clear diagnostic
// instead of Express's bare "Cannot GET /" so the cause is obvious in a browser.
app.get(/^\/(?!api\/).*/, (req, res) => {
  if (indexHtml) return res.sendFile(indexHtml);
  res
    .status(503)
    .type("html")
    .send(
      `<!doctype html><meta charset="utf-8"><title>Dashboard not deployed</title>` +
        `<body style="font:15px/1.6 system-ui;max-width:640px;margin:48px auto;padding:0 20px">` +
        `<h1>Dashboard files not found</h1>` +
        `<p>The API is running (<code>/api/health</code> works), but the dashboard ` +
        `<code>public/index.html</code> was not deployed with the server.</p>` +
        `<p><b>Fix:</b> include the <code>backend/public/</code> folder in the deploy ` +
        `(on Render, set <b>Root Directory</b> to <code>backend</code>), then redeploy.</p>` +
        `</body>`
    );
});

const PORT = process.env.PORT || 4000;

async function start() {
  let uri = process.env.MONGODB_URI;
  if (!uri || !uri.trim()) {
    // No MongoDB configured -> spin up a local embedded one (zero setup).
    console.log("[db] MONGODB_URI not set — using embedded MongoDB for local testing.");
    console.log("[db] (set MONGODB_URI in .env to use your own MongoDB or Atlas)");
    const { startEmbeddedMongo } = await import("./localdb.js");
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
