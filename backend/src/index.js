// index.js — Express server entry point

import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

// ── Import routes ─────────────────────────────────────────────
import healthRouter from "./routes/health.js";
import askRouter from "./routes/ask.js"; // 🆕 ADD THIS LINE

const app = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ────────────────────────────────────────────────
app.use(
  cors({
    origin: ["http://localhost:5173", "http://localhost:4173"],
    credentials: true,
  }),
);

app.use(express.json());

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ── Routes ────────────────────────────────────────────────────
app.use("/health", healthRouter);
app.use("/api/ask", askRouter); // 🆕 ADD THIS LINE

// ── 404 handler ───────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    error: "Route not found",
    path: req.path,
  });
});

// ── Global error handler ──────────────────────────────────────
app.use((err, req, res, next) => {
  console.error("[Error]", err.message);
  res.status(500).json({
    error: "Internal server error",
    message: err.message,
  });
});

// ── Start server ──────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════╗
║   Vibe backend running             ║
║   http://localhost:${PORT}           ║
║   ENV: ${process.env.NODE_ENV}          ║
╚════════════════════════════════════╝
  `);
});
