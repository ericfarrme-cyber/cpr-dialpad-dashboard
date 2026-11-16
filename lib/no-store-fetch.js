// Fetch for every server-side Supabase client: never let Next.js cache a read.
//
// Next.js 14 patches the global fetch and keeps GET responses in its Data Cache,
// keyed by URL. supabase-js reads are GETs, so a query whose URL repeats exactly
// (same table, filters and page) can be answered from that cache indefinitely —
// and on Vercel the cache survives deploys. `export const dynamic =
// "force-dynamic"` on the route did NOT stop it.
//
// Found 2026-11-16: Non-Phone Repair Traffic showed November at 69 tickets /
// $7,391.92 while the database held 78 / $8,408.28. The route answered 78 for
// every window nobody had requested before (2, 3, 5, 7, 12 months) and stale
// figures for exactly the two the app requests (6 months: 69; 14 months: 61).
//
// Passing cache: "no-store" on each request is the one setting the patched fetch
// always honours.
export function noStoreFetch(input, init) {
  return fetch(input, Object.assign({}, init || {}, { cache: "no-store" }));
}

export var NO_STORE_CLIENT_OPTIONS = { global: { fetch: noStoreFetch } };
