// llmRouter.js — The core fallback chain logic
//
// This is the function every route calls when it needs an LLM response.
// It tries P1 → P2 → P3 in order, skipping exhausted providers.
// If all are exhausted, it throws a structured error the route can catch.

import {
  geminiClient,
  groqClient,
  MODELS,
  isAvailable,
  markExhausted,
  getEarliestResetMinutes,
} from "./llm.js";

// ── callGemini ────────────────────────────────────────────────
// Calls the Gemini API using the official @google/genai SDK.
// model: "gemini-3.5-flash" or "gemini-2.5-flash"
// prompt: the string we send to the model

async function callGemini(model, systemPrompt, userPrompt) {
  const response = await geminiClient.models.generateContent({
    model: model,
    contents: userPrompt,
    config: {
      systemInstruction: systemPrompt,
      // Keep responses focused and fast
      maxOutputTokens: 1000,
      temperature: 0.3, // Lower = more consistent/structured output
    },
  });
  return response.text;
}

// ── callGroq ──────────────────────────────────────────────────
// Calls the Groq API using the official groq-sdk.

async function callGroq(systemPrompt, userPrompt) {
  const response = await groqClient.chat.completions.create({
    model: MODELS.P3,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    max_tokens: 1000,
    temperature: 0.3,
  });
  return response.choices[0].message.content;
}

// ── isRateLimitError ──────────────────────────────────────────
// Detects if an error from the API is a rate limit (429) error.
// Both Gemini and Groq use HTTP 429 for rate limiting.

function isRateLimitError(error) {
  return (
    error?.status === 429 ||
    error?.statusCode === 429 ||
    error?.message?.toLowerCase().includes("rate limit") ||
    error?.message?.toLowerCase().includes("quota") ||
    error?.message?.toLowerCase().includes("resource_exhausted")
  );
}

// ── routeLLM ──────────────────────────────────────────────────
// THE MAIN FUNCTION — call this from your routes.
//
// Usage:
//   const result = await routeLLM(systemPrompt, userPrompt);
//   result.text    → the LLM's response string
//   result.provider → which provider was used ("P1", "P2", "P3")
//
// Throws an error with { allExhausted: true, retryInMinutes: N }
// if all providers are rate-limited.

export async function routeLLM(systemPrompt, userPrompt) {
  // Define the chain: each entry is a provider name and its call function
  const chain = [
    {
      name: "P1",
      label: MODELS.P1,
      call: () => callGemini(MODELS.P1, systemPrompt, userPrompt),
    },
    {
      name: "P2",
      label: MODELS.P2,
      call: () => callGemini(MODELS.P2, systemPrompt, userPrompt),
    },
    {
      name: "P3",
      label: MODELS.P3,
      call: () => callGroq(systemPrompt, userPrompt),
    },
  ];

  // Walk the chain, skipping exhausted providers
  for (const provider of chain) {
    if (!isAvailable(provider.name)) {
      console.log(
        `[LLM] Skipping ${provider.name} (${provider.label}) — exhausted`,
      );
      continue;
    }

    try {
      console.log(`[LLM] Trying ${provider.name} (${provider.label})...`);
      const text = await provider.call();
      console.log(`[LLM] Success via ${provider.name}`);
      return { text, provider: provider.name, model: provider.label };
    } catch (error) {
      if (isRateLimitError(error)) {
        // Rate limit hit — mark exhausted and try next provider
        console.warn(`[LLM] ${provider.name} rate limited — falling back`);
        markExhausted(provider.name);
        continue;
      }
      // Non-rate-limit error (bad API key, network, etc.) — throw immediately
      console.error(`[LLM] ${provider.name} error:`, error.message);
      throw error;
    }
  }

  // All providers exhausted
  const retryInMinutes = getEarliestResetMinutes();
  const error = new Error("All LLM providers are currently rate-limited");
  error.allExhausted = true;
  error.retryInMinutes = retryInMinutes;
  throw error;
}
