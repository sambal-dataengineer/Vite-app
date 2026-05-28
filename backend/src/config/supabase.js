// src/config/supabase.js
// --------------------------------------------------
// WHY THIS FILE EXISTS:
// Instead of creating a new Supabase connection every time
// we need the DB, we create ONE client here and reuse it.
// This is called the "singleton" pattern — one instance, shared everywhere.
// --------------------------------------------------

import { createClient } from "@supabase/supabase-js";

// These come from your backend .env file
// NEVER put these in frontend code — they're server-side only
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY; // service role = full DB access

// Safety check — crash early with a clear message if env vars are missing
if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    "Missing Supabase credentials. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env",
  );
}

// Create and export the single Supabase client
// All other files will import THIS, not create their own
const supabase = createClient(supabaseUrl, supabaseKey);

export default supabase;
