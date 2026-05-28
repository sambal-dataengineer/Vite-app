// health.js — GET /health
//
// This route does two things:
//   1. Confirms the server is running (basic liveness check)
//   2. Shows the current state of the LLM fallback chain
//
// In production apps, a load balancer hits this route every 30s
// to confirm the service is alive. For us, it's a great debugging tool.

import { Router } from "express";
import { rateLimitState, MODELS } from "../config/llm.js";

const router = Router();

router.get("/", (req, res) => {
  // Build a readable status for each provider
  const llmStatus = {
    P1: {
      model: MODELS.P1,
      available: !rateLimitState.P1.exhausted,
      resetsAt: rateLimitState.P1.resetsAt,
    },
    P2: {
      model: MODELS.P2,
      available: !rateLimitState.P2.exhausted,
      resetsAt: rateLimitState.P2.resetsAt,
    },
    P3: {
      model: MODELS.P3,
      available: !rateLimitState.P3.exhausted,
      resetsAt: rateLimitState.P3.resetsAt,
    },
  };

  res.json({
    status: "ok",
    message: "Vibe backend is running",
    timestamp: new Date().toISOString(),
    llm: llmStatus,
  });
});

export default router;
