import { createClient } from "@supabase/supabase-js";

let supabaseBrowser = null;

export function getSupabaseBrowser() {
  if (supabaseBrowser) return supabaseBrowser;
  supabaseBrowser = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
  return supabaseBrowser;
}
