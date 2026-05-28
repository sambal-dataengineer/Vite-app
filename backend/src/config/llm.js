// llm.js — LLM Waterfall Fallback Chain
//
// This file does two things:
//   1. Creates SDK client instances for each provider
//   2. Tracks which providers are currently rate-limited
//
// The state object below is the "in-memory" store we discussed.
// It lives as long as the server process is running.

import { GoogleGenAI } from "@google/genai";
import Groq from "groq-sdk";
import dotenv from "dotenv";

dotenv.config();

// ── Provider client instances ─────────────────────────────────
// These are created once when the server starts.
// Think of them as "phone lines" to each provider.

export const geminiClient = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

export const groqClient = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

// ── Model identifiers ─────────────────────────────────────────
// Centralised here so changing a model name is a 1-line edit.

export const MODELS = {
  P1: "gemini-3.5-flash", // Primary — fastest, most capable
  P2: "gemini-2.5-flash", // Secondary — fallback when P1 exhausted
  P3: "llama-3.3-70b-versatile", // Tertiary — Groq, last resort
};

// ── In-memory rate limit state ────────────────────────────────
// Tracks when each provider hit its rate limit and when it resets.
//
// Structure:
// {
//   P1: { exhausted: false, resetsAt: null },
//   P2: { exhausted: false, resetsAt: null },
//   P3: { exhausted: false, resetsAt: null },
// }
//
// resetsAt is a JS Date object. When Date.now() > resetsAt,
// we consider the provider available again.

export const rateLimitState = {
  P1: { exhausted: false, resetsAt: null },
  P2: { exhausted: false, resetsAt: null },
  P3: { exhausted: false, resetsAt: null },
};

// ── Helper: check if a provider is available ─────────────────
// Returns true if the provider is NOT exhausted, or if its
// reset window has passed (quota refilled).

export function isAvailable(provider) {
  const state = rateLimitState[provider];

  // If never exhausted, it's available
  if (!state.exhausted) return true;

  // If exhausted but reset time has passed, mark it available again
  if (state.resetsAt && Date.now() > state.resetsAt.getTime()) {
    state.exhausted = false;
    state.resetsAt = null;
    console.log(`[LLM] ${provider} quota reset — available again`);
    return true;
  }

  // Still exhausted
  return false;
}

// ── Helper: mark a provider as rate-limited ───────────────────
// resetMinutes: how long until we try this provider again.
// Gemini free tier resets every 60 seconds for RPM limits,
// but daily TPD limits reset at midnight. We use 60s as a
// conservative default for the prototype.

export function markExhausted(provider, resetMinutes = 1) {
  rateLimitState[provider].exhausted = true;
  rateLimitState[provider].resetsAt = new Date(
    Date.now() + resetMinutes * 60 * 1000,
  );
  console.log(
    `[LLM] ${provider} marked exhausted — retrying after ${resetMinutes} min`,
  );
}

// ── Helper: get time until earliest provider resets ───────────
// Used to tell the user "try again in N minutes"

export function getEarliestResetMinutes() {
  const times = Object.values(rateLimitState)
    .filter((s) => s.exhausted && s.resetsAt)
    .map((s) => s.resetsAt.getTime());

  if (times.length === 0) return 0;

  const earliestMs = Math.min(...times);
  return Math.ceil((earliestMs - Date.now()) / 60000);
}
