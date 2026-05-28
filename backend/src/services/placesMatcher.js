// src/services/placesMatcher.js
// --------------------------------------------------
// THE HEART OF VIBE'S MATCHING LOGIC
//
// This file answers ONE question:
// "Given what the user wants, which single place fits best?"
//
// Strategy:
//   1. Use hard filters to eliminate non-matches (wrong category, closed, over budget)
//   2. Score remaining places by how well they match soft criteria (vibe, noise, tags)
//   3. Return the highest-scoring place
//
// WHY NOT JUST USE SQL ORDER BY RANDOM()?
// Because random picks often feel wrong. A user asking for a "quiet study spot"
// shouldn't get a random cafe — they should get the one tagged 'quiet' + 'wifi'.
// Scoring makes the recommendation feel intelligent, not accidental.
// --------------------------------------------------

import supabase from "../config/supabase.js";

// --------------------------------------------------
// BUDGET MAP
// The LLM returns budget as "low" / "medium" / "high"
// Our DB stores it as budget_tier: 1, 2, or 3
// This map translates between the two
// --------------------------------------------------
const BUDGET_TIER_MAP = {
  low: [1], // budget: only tier-1 places
  medium: [1, 2], // medium: tier 1 or 2
  high: [1, 2, 3], // high: any tier is fine
};

// --------------------------------------------------
// MAIN FUNCTION: findBestMatch(intent)
//
// intent shape (from LLM):
// {
//   category: "cafe" | "restaurant" | "park" | "bar" | etc,
//   budget: "low" | "medium" | "high",
//   vibe_tags: ["quiet", "cozy", "work-friendly"],   ← array
//   noise_level: "quiet" | "moderate" | "lively",
//   time_of_day: "morning" | "afternoon" | "evening" | "night"
// }
// --------------------------------------------------
export async function findBestMatch(intent) {
  try {
    // ── STEP A: Build the base query ──────────────────────────────────────
    // We start by fetching ALL places, then narrow down.
    // We use .select('*') to get every column — useful during development.
    // In production, you'd select only the columns you need.
    let query = supabase
      .from("places") // your table name in Supabase
      .select("*");

    // ── STEP B: Hard Filter — Category ───────────────────────────────────
    // If the LLM identified a category, only show places of that type.
    // "cafe" → only cafes, "restaurant" → only restaurants, etc.
    if (intent.category && intent.category !== "any") {
      query = query.ilike("category", `%${intent.category}%`);
      // ilike = case-insensitive LIKE — matches "Cafe", "cafe", "CAFE"
      // The % wildcards mean "contains this word anywhere"
    }

    // ── STEP C: Hard Filter — Budget ─────────────────────────────────────
    // Convert the LLM's budget word to tier numbers and filter
    if (intent.budget && BUDGET_TIER_MAP[intent.budget]) {
      const allowedTiers = BUDGET_TIER_MAP[intent.budget];
      query = query.in("budget_tier", allowedTiers);
      // .in() = SQL "WHERE budget_tier IN (1, 2)"
    }

    // ── STEP D: Fetch the filtered results ───────────────────────────────
    // We limit to 20 candidates max — enough to score, not too many to slow things down
    query = query.limit(20);

    const { data: candidates, error } = await query;

    if (error) {
      console.error("[placesMatcher] Supabase query error:", error.message);
      throw new Error("Database query failed: " + error.message);
    }

    // If no candidates found even after relaxed filters, return null
    if (!candidates || candidates.length === 0) {
      console.log("[placesMatcher] No candidates found for intent:", intent);
      return null;
    }

    console.log(
      `[placesMatcher] ${candidates.length} candidates after hard filters`,
    );

    // ── STEP E: Score each candidate ─────────────────────────────────────
    // For each place, calculate a "match score" based on soft criteria.
    // Higher score = better match for this user's intent.
    const scored = candidates.map((place) => {
      let score = 0;

      // +3 points: vibe_tags overlap
      // Example: user wants ["quiet", "cozy"], place has ["quiet", "wifi", "cozy"]
      // Overlap = 2 tags → score += 6
      if (
        intent.vibe_tags &&
        Array.isArray(intent.vibe_tags) &&
        place.vibe_tags
      ) {
        const placeTags = Array.isArray(place.vibe_tags) ? place.vibe_tags : [];
        const overlap = intent.vibe_tags.filter((tag) =>
          placeTags.map((t) => t.toLowerCase()).includes(tag.toLowerCase()),
        );
        score += overlap.length * 3;
      }

      // +2 points: noise_level match
      if (intent.noise_level && place.noise_level) {
        if (
          intent.noise_level.toLowerCase() === place.noise_level.toLowerCase()
        ) {
          score += 2;
        }
      }

      // +2 points: time_of_day match via best_for column
      // best_for might be like ["morning", "work"] or "morning, evening"
      if (intent.time_of_day && place.best_for) {
        const bestFor = Array.isArray(place.best_for)
          ? place.best_for.join(" ")
          : String(place.best_for);
        if (bestFor.toLowerCase().includes(intent.time_of_day.toLowerCase())) {
          score += 2;
        }
      }

      // +1 point: match_keywords overlap (broad keyword matching)
      if (intent.vibe_tags && place.match_keywords) {
        const keywords = Array.isArray(place.match_keywords)
          ? place.match_keywords
          : String(place.match_keywords).split(",");
        const keywordHits = intent.vibe_tags.filter((tag) =>
          keywords
            .map((k) => k.trim().toLowerCase())
            .includes(tag.toLowerCase()),
        );
        score += keywordHits.length * 1;
      }

      return { ...place, _score: score }; // attach score to the place object
    });

    // ── STEP F: Sort by score (highest first) ────────────────────────────
    scored.sort((a, b) => b._score - a._score);

    // Log scores during development — helpful for tuning
    console.log(
      "[placesMatcher] Top 3 scored places:",
      scored.slice(0, 3).map((p) => ({ name: p.name, score: p._score })),
    );

    // ── STEP G: Return the SINGLE best match ─────────────────────────────
    // If top candidates have the same score, pick randomly among them
    // (avoids always returning the same place for identical queries)
    const topScore = scored[0]._score;
    const topTied = scored.filter((p) => p._score === topScore);
    const winner = topTied[Math.floor(Math.random() * topTied.length)];

    // Remove the internal _score before returning to client
    const { _score, ...cleanPlace } = winner;
    return cleanPlace;
  } catch (err) {
    console.error("[placesMatcher] Unexpected error:", err.message);
    throw err;
  }
}
