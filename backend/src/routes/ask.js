// ask.js — POST /api/ask
//
// This route is the "ear" of Vibe.
// It receives a user's natural language message,
// sends it to the LLM for intent extraction,
// and returns a structured JSON object the next step can use.

import express from "express";

// Import routeLLM from your existing fallback chain
// routeLLM(systemPrompt, userPrompt) → { text, provider, model }
import { routeLLM } from "../config/llmRouter.js";

const router = express.Router();

// ─────────────────────────────────────────────
// HELPER: Get current time in IST as a readable string
// ─────────────────────────────────────────────
// Why IST? Because Vibe is Bengaluru-only.
// We inject this into the prompt so the LLM can
// infer time_of_day when the user doesn't mention it.

function getCurrentISTTime() {
  // "Asia/Kolkata" is the IANA timezone name for IST (UTC+5:30)
  const now = new Date();
  const timeString = now.toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true, // e.g., "09:45 PM"
  });
  const hour = parseInt(
    now.toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "numeric",
      hour12: false,
    }),
  );

  // Map hour → time_of_day label
  // This helps the LLM use a consistent vocabulary
  let timeOfDay;
  if (hour >= 5 && hour < 12) timeOfDay = "morning";
  else if (hour >= 12 && hour < 17) timeOfDay = "afternoon";
  else if (hour >= 17 && hour < 21) timeOfDay = "evening";
  else timeOfDay = "night";

  return { timeString, timeOfDay };
}

// ─────────────────────────────────────────────
// SYSTEM PROMPT FACTORY
// ─────────────────────────────────────────────
// This is a function (not a constant) because it needs
// the current time — which changes with every request.
// We call it fresh each time POST /api/ask is hit.

function buildSystemPrompt(currentTime, defaultTimeOfDay) {
  return `
You are an intent extraction engine for Vibe, a local discovery app in Bengaluru, India.

Your ONLY job is to analyze the user's message and extract their intent as a JSON object.
You must ALWAYS respond with valid JSON. No explanations. No markdown. No code blocks.
Just the raw JSON object, nothing else.

Current time in Bengaluru: ${currentTime} (${defaultTimeOfDay})

Extract these fields:

1. "mood" — How is the user feeling or what vibe are they going for?
   Valid values: "lazy", "energetic", "romantic", "social", "focused", "adventurous", "chill", "celebratory", "unknown"

2. "category" — What type of place are they looking for?
   Valid values: "cafe", "restaurant", "bar", "park", "activity", "shopping", "dessert", "unknown"

3. "budget" — What price range do they seem to want?
   Valid values: "low" (under ₹300/person), "medium" (₹300–₹800/person), "high" (above ₹800/person), "unknown"

4. "keywords" — A list of 1–4 specific things they mentioned (drinks, food, atmosphere, etc.)
   Example: ["filter coffee", "quiet", "outdoor seating"]
   If nothing specific is mentioned, return an empty array: []

5. "distance" — Did they mention how far they want to travel?
   Valid values: "nearby" (under 2km), "moderate" (2–5km), "far" (any distance), "unknown"

6. "time_of_day" — When does the user want to go?
   Valid values: "morning", "afternoon", "evening", "night"
   IMPORTANT: If the user does not mention a time, use the current time of day: "${defaultTimeOfDay}"
   Never return "unknown" for this field.

Rules:
- If unsure about any field (except time_of_day), use "unknown"
- "keywords" must always be an array, even if empty []
- Infer intelligently: "I'm lazy" → mood: "lazy", "date night" → mood: "romantic", category: "restaurant"
- Bengaluru context: "darshini" = quick south Indian breakfast cafe, "pub" = bar, "brigade road" = shopping/social

Example input: "I'm lazy but want filter coffee"
Example output:
{
  "mood": "lazy",
  "category": "cafe",
  "budget": "low",
  "keywords": ["filter coffee"],
  "distance": "unknown",
  "time_of_day": "${defaultTimeOfDay}"
}
`.trim();
}

// ─────────────────────────────────────────────
// POST /api/ask
// ─────────────────────────────────────────────

router.post("/", async (req, res) => {
  try {
    // ── 1. Validate input ──────────────────────────────────────
    const { message } = req.body;

    if (!message || typeof message !== "string" || message.trim() === "") {
      return res.status(400).json({
        error: "Message is required",
        hint: 'Send: { "message": "your text here" }',
      });
    }

    const trimmedMessage = message.trim();
    console.log(`[ask] Received: "${trimmedMessage}"`);

    // ── 2. Get current IST time ────────────────────────────────
    // We do this per-request so time is always accurate
    const { timeString, timeOfDay } = getCurrentISTTime();
    console.log(`[ask] Current IST time: ${timeString} → ${timeOfDay}`);

    // ── 3. Build prompts ───────────────────────────────────────
    // systemPrompt: the "rules" for the LLM (includes current time)
    // userPrompt: the user's actual message, wrapped in a clear instruction
    const systemPrompt = buildSystemPrompt(timeString, timeOfDay);
    const userPrompt = `Extract the intent from this message and return ONLY a raw JSON object (no markdown, no code blocks):\n\n"${trimmedMessage}"`;

    // ── 4. Call the LLM via fallback chain ─────────────────────
    // routeLLM returns { text, provider, model }
    // text = the LLM's raw response string
    // provider = which one answered ("P1", "P2", or "P3")
    console.log("[ask] Sending to LLM...");
    const {
      text: rawResponse,
      provider,
      model,
    } = await routeLLM(systemPrompt, userPrompt);
    console.log(`[ask] Response from ${provider} (${model}): ${rawResponse}`);

    // ── 5. Clean and parse the JSON response ───────────────────
    // LLMs sometimes add markdown code fences even when told not to.
    // We strip those out defensively before parsing.
    const cleaned = rawResponse
      .replace(/```json\s*/gi, "") // remove ```json
      .replace(/```\s*/g, "") // remove closing ```
      .trim();

    let intent;
    try {
      intent = JSON.parse(cleaned);
    } catch (parseError) {
      console.error("[ask] JSON parse failed. Raw response was:", rawResponse);
      return res.status(422).json({
        error: "LLM returned invalid JSON",
        raw: rawResponse,
        hint: "Try rephrasing your message.",
      });
    }

    // ── 6. Fill any missing fields with safe defaults ──────────
    // Even if the LLM skips a field, we guarantee the shape
    // so Step 4 (Supabase query) always receives consistent data.
    const defaults = {
      mood: "unknown",
      category: "unknown",
      budget: "unknown",
      keywords: [],
      distance: "unknown",
      time_of_day: timeOfDay, // never "unknown" — always current IST time
    };

    // Merge: intent fields take priority, defaults fill any gaps
    const safeIntent = { ...defaults, ...intent };

    // Ensure keywords is always an array (LLM occasionally returns a string)
    if (!Array.isArray(safeIntent.keywords)) {
      safeIntent.keywords = safeIntent.keywords ? [safeIntent.keywords] : [];
    }

    // ── 7. Return the structured intent ───────────────────────
    console.log("[ask] Final intent:", safeIntent);

    res.json({
      success: true,
      message: trimmedMessage,
      intent: safeIntent,
      _meta: {
        // Useful during development to see which LLM answered
        provider,
        model,
        time_injected: timeString,
      },
    });
  } catch (error) {
    // Handle the "all providers exhausted" case gracefully
    if (error.allExhausted) {
      console.warn("[ask] All LLM providers rate-limited");
      return res.status(503).json({
        error: "All AI providers are currently busy",
        retryInMinutes: error.retryInMinutes,
        hint: `Please try again in ${error.retryInMinutes} minute(s)`,
      });
    }

    console.error("[ask] Unexpected error:", error.message);
    res.status(500).json({
      error: "Internal server error",
      details: error.message,
    });
  }
});

export default router;
