// src/services/placesMatcher.js  v3
// Fixes: budget column name, category mapping, mood scoring, keyword aliases

import supabase from "../config/supabase.js";

// --------------------------------------------------
// CATEGORY MAP
// LLM speaks: "cafe", "restaurant", "bar", "park", "activity"
// DB stores:  "Cafe", "Restaurant", "Bar", "Park",
//             "Outdoors", "Work & Study", "Unique & Special"
//
// We map LLM categories → one or more DB categories to query
// --------------------------------------------------
const CATEGORY_MAP = {
  cafe: ["Cafe"],
  restaurant: ["Restaurant"],
  bar: ["Bar"],
  park: ["Park", "Outdoors"],
  outdoors: ["Outdoors", "Park"],
  activity: ["Unique & Special", "Work & Study", "Outdoors"],
  work: ["Work & Study", "Cafe"],
  study: ["Work & Study", "Cafe"],
  unique: ["Unique & Special"],
};

// --------------------------------------------------
// BUDGET MAP
// LLM speaks: "low", "medium", "high"
// DB stores:  budget TEXT — 'Free', '₹', '₹₹', '₹₹₹', '₹₹₹₹'
// --------------------------------------------------
const BUDGET_MAP = {
  low: ["Free", "₹"],
  medium: ["Free", "₹", "₹₹"],
  high: ["Free", "₹", "₹₹", "₹₹₹", "₹₹₹₹"],
};

// --------------------------------------------------
// MOOD → TAG ALIASES
// LLM extracts mood. DB has vibe_tags and match_keywords.
// This maps moods to tags likely in the DB.
// --------------------------------------------------
const MOOD_ALIASES = {
  chill: [
    "chill",
    "relaxed",
    "laid-back",
    "casual",
    "cozy",
    "calm",
    "warm",
    "unhurried",
  ],
  focused: [
    "productive",
    "work-friendly",
    "focused",
    "quiet",
    "study",
    "serious",
  ],
  romantic: [
    "romantic",
    "intimate",
    "cozy",
    "date-night",
    "beautiful",
    "design-led",
  ],
  social: ["social", "group", "lively", "fun", "buzzy", "cheerful"],
  adventurous: [
    "adventurous",
    "unique",
    "offbeat",
    "hidden gem",
    "different",
    "unusual",
  ],
  lazy: [
    "casual",
    "neighbourhood",
    "comfortable",
    "unpretentious",
    "homey",
    "local",
  ],
  energetic: ["lively", "loud", "buzzy", "social", "energetic", "fun"],
  celebratory: [
    "celebration",
    "special occasion",
    "fun",
    "group",
    "social",
    "festive",
  ],
};

// --------------------------------------------------
// KEYWORD ALIASES
// LLM keyword → DB tag vocabulary bridge
// --------------------------------------------------
const KEYWORD_ALIASES = {
  work: ["work-friendly", "productive", "laptop", "wifi", "focused", "work"],
  study: ["work-friendly", "productive", "laptop", "wifi", "quiet", "study"],
  quiet: ["quiet", "peaceful", "calm", "silent", "serene", "unhurried"],
  "filter coffee": [
    "filter coffee",
    "coffee",
    "south indian coffee",
    "specialty coffee",
    "kapi",
  ],
  coffee: ["coffee", "specialty coffee", "filter coffee", "cafe"],
  quick: ["quick bites", "fast", "takeaway", "express"],
  outdoor: [
    "outdoor seating",
    "open air",
    "terrace",
    "nature",
    "park",
    "green",
  ],
  date: ["romantic", "cozy", "date-night", "intimate", "couple", "beautiful"],
  cheap: ["affordable", "value", "budget", "free"],
  affordable: ["affordable", "value", "budget"],
  group: ["group", "family", "social", "large table"],
  romantic: ["romantic", "intimate", "cozy", "date-night"],
  breakfast: ["breakfast", "morning", "south indian", "tiffin"],
  beer: ["beer", "craft beer", "microbrewery", "pub", "bar", "drinks"],
  trek: ["trek", "adventure", "outdoors", "nature", "sunrise", "physical"],
  exploration: ["adventure", "unique", "offbeat", "outdoors", "nature"],
  library: ["quiet", "study", "books", "bookstore", "silent", "focused"],
  workspace: ["work-friendly", "coworking", "laptop", "wifi", "productive"],
  warm: ["warm", "cozy", "comfort food", "nostalgic", "homey"],
  nature: ["nature", "green", "park", "outdoor", "peaceful", "lake"],
  art: ["art", "gallery", "artsy", "creative", "intellectual"],
  books: ["books", "bookstore", "literary", "reading", "intellectual"],
};

function expandKeywords(keywords) {
  const expanded = new Set();
  keywords.forEach((kw) => {
    const lower = kw.toLowerCase();
    expanded.add(lower);
    const aliases = KEYWORD_ALIASES[lower];
    if (aliases) aliases.forEach((a) => expanded.add(a));
  });
  return Array.from(expanded);
}

function expandMood(mood) {
  if (!mood || mood === "unknown") return [];
  const aliases = MOOD_ALIASES[mood.toLowerCase()];
  return aliases ? aliases : [mood.toLowerCase()];
}

// --------------------------------------------------
// MAIN FUNCTION
// --------------------------------------------------
export async function findBestMatch(intent) {
  try {
    let query = supabase.from("places").select("*").eq("is_active", true);

    // ── Hard Filter: Category ─────────────────────────────────
    if (intent.category && intent.category !== "unknown") {
      const dbCategories = CATEGORY_MAP[intent.category.toLowerCase()];
      if (dbCategories && dbCategories.length > 0) {
        query = query.in("category", dbCategories);
        console.log(
          `[placesMatcher] Category filter: "${intent.category}" → DB categories: ${dbCategories}`,
        );
      }
      // If no mapping found, skip category filter (don't eliminate everything)
    }

    // ── Hard Filter: Budget ───────────────────────────────────
    if (
      intent.budget &&
      intent.budget !== "unknown" &&
      BUDGET_MAP[intent.budget]
    ) {
      const allowedBudgets = BUDGET_MAP[intent.budget];
      query = query.in("budget", allowedBudgets);
      console.log(
        `[placesMatcher] Budget filter: "${intent.budget}" → ${allowedBudgets}`,
      );
    }

    query = query.limit(20);

    const { data: candidates, error } = await query;

    if (error) {
      console.error("[placesMatcher] Supabase query error:", error.message);
      throw new Error("Database query failed: " + error.message);
    }

    if (!candidates || candidates.length === 0) {
      console.log(
        "[placesMatcher] No candidates found — relaxing category filter...",
      );

      // FALLBACK: retry without category filter
      const { data: fallback, error: fbError } = await supabase
        .from("places")
        .select("*")
        .eq("is_active", true)
        .limit(20);

      if (fbError || !fallback || fallback.length === 0) return null;
      return scoreAndPick(fallback, intent);
    }

    console.log(
      `[placesMatcher] ${candidates.length} candidates after hard filters`,
    );
    return scoreAndPick(candidates, intent);
  } catch (err) {
    console.error("[placesMatcher] Unexpected error:", err.message);
    throw err;
  }
}

// --------------------------------------------------
// SCORER — separated for reuse in fallback
// --------------------------------------------------
function scoreAndPick(candidates, intent) {
  const expandedKeywords =
    intent.keywords?.length > 0 ? expandKeywords(intent.keywords) : [];

  const expandedMood = expandMood(intent.mood);

  console.log("[placesMatcher] Expanded keywords:", expandedKeywords);
  console.log("[placesMatcher] Expanded mood tags:", expandedMood);

  const scored = candidates.map((place) => {
    let score = 0;

    // ── +5 pts: Exact category match ─────────────────────────
    if (intent.category && intent.category !== "unknown" && place.category) {
      const dbCategories = CATEGORY_MAP[intent.category.toLowerCase()] || [];
      if (dbCategories.includes(place.category)) {
        score += 5;
      }
    }

    // ── +3 pts per vibe_tag match (keywords) ─────────────────
    if (expandedKeywords.length > 0 && place.vibe_tags) {
      const placeTags = Array.isArray(place.vibe_tags)
        ? place.vibe_tags.map((t) => t.toLowerCase())
        : [];
      const tagOverlap = expandedKeywords.filter((kw) =>
        placeTags.includes(kw),
      );
      score += tagOverlap.length * 3;
      if (tagOverlap.length > 0) {
        console.log(
          `  [score] ${place.name}: vibe_tag hits → [${tagOverlap}] (+${tagOverlap.length * 3})`,
        );
      }
    }

    // ── +3 pts per vibe_tag match (mood) ─────────────────────
    if (expandedMood.length > 0 && place.vibe_tags) {
      const placeTags = Array.isArray(place.vibe_tags)
        ? place.vibe_tags.map((t) => t.toLowerCase())
        : [];
      const moodOverlap = expandedMood.filter((m) => placeTags.includes(m));
      score += moodOverlap.length * 3;
      if (moodOverlap.length > 0) {
        console.log(
          `  [score] ${place.name}: mood vibe_tag hits → [${moodOverlap}] (+${moodOverlap.length * 3})`,
        );
      }
    }

    // ── +2 pts per match_keyword hit (keywords) ──────────────
    if (expandedKeywords.length > 0 && place.match_keywords) {
      const placeKws = Array.isArray(place.match_keywords)
        ? place.match_keywords.map((k) => k.toLowerCase())
        : String(place.match_keywords)
            .split(",")
            .map((k) => k.trim().toLowerCase());
      const kwOverlap = expandedKeywords.filter((kw) => placeKws.includes(kw));
      score += kwOverlap.length * 2;
      if (kwOverlap.length > 0) {
        console.log(
          `  [score] ${place.name}: match_kw hits → [${kwOverlap}] (+${kwOverlap.length * 2})`,
        );
      }
    }

    // ── +2 pts per match_keyword hit (mood) ──────────────────
    if (expandedMood.length > 0 && place.match_keywords) {
      const placeKws = Array.isArray(place.match_keywords)
        ? place.match_keywords.map((k) => k.toLowerCase())
        : String(place.match_keywords)
            .split(",")
            .map((k) => k.trim().toLowerCase());
      const moodKwOverlap = expandedMood.filter((m) => placeKws.includes(m));
      score += moodKwOverlap.length * 2;
      if (moodKwOverlap.length > 0) {
        console.log(
          `  [score] ${place.name}: mood match_kw hits → [${moodKwOverlap}] (+${moodKwOverlap.length * 2})`,
        );
      }
    }

    // ── +2 pts: noise_level match ─────────────────────────────
    if (
      intent.noise_level &&
      intent.noise_level !== "unknown" &&
      place.noise_level
    ) {
      if (
        intent.noise_level.toLowerCase() === place.noise_level.toLowerCase()
      ) {
        score += 2;
      }
    }

    // ── +1 pt: time_of_day in best_for ───────────────────────
    if (intent.time_of_day && place.best_for) {
      const bestFor = Array.isArray(place.best_for)
        ? place.best_for.join(" ").toLowerCase()
        : String(place.best_for).toLowerCase();
      if (bestFor.includes(intent.time_of_day.toLowerCase())) {
        score += 1;
      }
    }

    // ── +1 pt: popularity tiebreaker ─────────────────────────
    // Among tied places, slightly prefer the more popular one
    score += (place.popularity_score || 0) / 100;

    return { ...place, _score: score };
  });

  scored.sort((a, b) => b._score - a._score);

  console.log(
    "[placesMatcher] Top 5 scored places:",
    scored
      .slice(0, 5)
      .map((p) => ({ name: p.name, score: p._score.toFixed(1) })),
  );

  // Pick winner — if top scores are within 1 point of each other, randomise
  const topScore = scored[0]._score;
  const topTied = scored.filter((p) => p._score >= topScore - 1);
  const winner = topTied[Math.floor(Math.random() * topTied.length)];

  const { _score, ...cleanPlace } = winner;
  return cleanPlace;
}
