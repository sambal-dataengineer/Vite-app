// replyGenerator.js — Generates the final human-sounding reply
//
// This is LLM Call #2 in the Vibe pipeline.
// It receives a matched place + the user's extracted intent,
// and returns a warm, conversational 2-3 sentence recommendation.
//
// Why a separate file?
// Single Responsibility: ask.js orchestrates, this file writes.
// This function can be reused or swapped without touching ask.js.

import { routeLLM } from "../config/llmRouter.js";

// ─────────────────────────────────────────────
// SYSTEM PROMPT — Vibe's personality
// ─────────────────────────────────────────────
// This is a constant because Vibe's personality never changes.
// It defines WHO the LLM is pretending to be.

const REPLY_SYSTEM_PROMPT = `
You are Vibe — a warm, opinionated local friend in Bengaluru who gives 
exactly ONE place recommendation per conversation. 

Your personality:
- You sound like a person, not a search engine or review site
- You are specific and confident — no hedging like "you might like" or "it could be"
- You reference the user's exact mood or context to show you understood them
- You mention 1-2 specific details about the place (atmosphere, a dish, a feature)
- You are concise — exactly 2-3 sentences, never more
- You never use bullet points, lists, ratings, or review-style language
- You never say "I recommend" or "I suggest" — just talk naturally
- You end on something that makes the person want to go RIGHT NOW
- You ONLY describe the exact place given to you — never invent or substitute details

Tone: Like texting a friend who knows every good spot in the city.
`.trim();

// ─────────────────────────────────────────────
// HELPER: Build the user prompt from place + intent
// ─────────────────────────────────────────────
// This is a function (not a constant) because place and intent
// are different for every request.

function buildReplyPrompt(place, intent, originalMessage) {
  // Pull out the fields we want to give the LLM
  // We're selective — give it enough context, not a data dump

  const placeContext = `
Place details:
- Name: ${place.name}
- Area: ${place.area}, ${place.city}
- Category: ${place.category}
- Budget: ${place.budget} (${getBudgetLabel(place.budget)})
- Known for: ${place.description || "a great local spot"}
- Vibe tags: ${Array.isArray(place.vibe_tags) ? place.vibe_tags.join(", ") : "local favourite"}
- Best for: ${Array.isArray(place.best_for) ? place.best_for.join(", ") : "general visits"}
- Noise level: ${place.noise_level || "moderate"}
`.trim();

  const userContext = `
User's situation:
- What they said: "${originalMessage}"
- Mood: ${intent.mood}
- Time of day: ${intent.time_of_day}
- Budget preference: ${intent.budget}
- Keywords they mentioned: ${intent.keywords.length > 0 ? intent.keywords.join(", ") : "none specific"}
`.trim();

  return `
${placeContext}

${userContext}

Write a 2-3 sentence reply recommending this place to this person.

STRICT RULES:
- You MUST use the exact place name: "${place.name}"
- You MUST mention the exact area: "${place.area}"  
- Do NOT substitute, rename, or invent a different place
- Do NOT add any place details you weren't given above
- Respond with ONLY the reply text — no labels, no JSON, no markdown
`.trim();
}

// ─────────────────────────────────────────────
// HELPER: Convert budget symbol to readable label
// ─────────────────────────────────────────────
// Our DB stores budget as '₹', '₹₹', etc.
// We translate this so the LLM understands what it means.

function getBudgetLabel(budgetSymbol) {
  const labels = {
    Free: "completely free",
    "₹": "very affordable, under ₹300/person",
    "₹₹": "mid-range, ₹300–₹800/person",
    "₹₹₹": "premium, ₹800–₹1500/person",
    "₹₹₹₹": "fine dining, above ₹1500/person",
  };
  return labels[budgetSymbol] || "moderate pricing";
}

// ─────────────────────────────────────────────
// MAIN EXPORT: generateReply
// ─────────────────────────────────────────────
// Called from ask.js after a place is matched.
//
// Parameters:
//   place          — the full place object from Supabase
//   intent         — the extracted intent from LLM Call #1
//   originalMessage — the user's raw message (for context)
//
// Returns:
//   A plain string — the reply text to send to the user
//   Falls back to a safe default if the LLM fails

export async function generateReply(place, intent, originalMessage) {
  try {
    const userPrompt = buildReplyPrompt(place, intent, originalMessage);

    console.log("[replyGenerator] Generating reply for:", place.name);

    // Re-use the same fallback chain (P1 → P2 → P3)
    // If Call #1 used P1, and P1 is still available, it uses P1 again.
    // If P1 got rate-limited during Call #1, it'll fall to P2 here.
    const { text, provider, model } = await routeLLM(
      REPLY_SYSTEM_PROMPT,
      userPrompt,
    );

    console.log(`[replyGenerator] Got reply from ${provider} (${model})`);

    // Clean up any accidental leading/trailing whitespace or quotes
    // Some LLMs wrap their response in quotation marks — strip those
    const cleanReply = text.trim().replace(/^["']|["']$/g, ""); // remove surrounding quotes if any

    return cleanReply;
  } catch (error) {
    // If LLM Call #2 fails (all providers exhausted after Call #1),
    // we don't crash — we return a decent fallback reply instead.
    // The user still gets a recommendation, just not a poetic one.
    console.warn(
      "[replyGenerator] LLM failed, using fallback reply:",
      error.message,
    );

    // Fallback: a simple but still useful reply using place data
    return `${place.name} in ${place.area} is a solid pick for this. Worth checking out.`;
  }
}
