// index.js — Express server entry point
//
// This is the file that starts everything.
// It wires together:
//   - Express middleware (cors, json parsing)
//   - All routes
//   - The server listener

import express from "express";
import cors from "cors";
import dotenv from "dotenv";

// Load .env variables FIRST before any other imports that need them
dotenv.config();

// Import routes
import healthRouter from "./routes/health.js";

const app = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ────────────────────────────────────────────────
// Middleware runs on EVERY request before it hits a route.

// CORS: allows your frontend (localhost:5173) to call this backend
app.use(
  cors({
    origin: [
      "http://localhost:5173", // Vite dev server
      "http://localhost:4173", // Vite preview
    ],
    credentials: true,
  }),
);

// JSON parser: lets us read req.body as a JS object
app.use(express.json());

// Request logger: prints every incoming request to the terminal
// Very useful during development to see what's happening
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next(); // "next" means: continue to the actual route handler
});

// ── Routes ────────────────────────────────────────────────────
// Mount each router at its base path.
// All routes in health.js will be prefixed with /health

app.use("/health", healthRouter);

// 404 handler — catches any request to a route that doesn't exist
app.use((req, res) => {
  res.status(404).json({
    error: "Route not found",
    path: req.path,
  });
});

// Global error handler — catches any unhandled errors in routes
app.use((err, req, res, next) => {
  console.error("[Error]", err.message);
  res.status(500).json({
    error: "Internal server error",
    message: err.message,
  });
});

// ── Start the server ──────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════╗
║   Vibe backend running             ║
║   http://localhost:${PORT}           ║
║   ENV: ${process.env.NODE_ENV}          ║
╚════════════════════════════════════╝
  `);
});
