// Server-side read of review_credit_decisions -- the manager's Confirm / Not
// them / Acknowledge on each review. ONE loader, used by every route that
// computes review credits (google-tracking credits + my_reviews, the Bonus
// Ledger), so the queue, the technician's card and the payout cannot read the
// decisions differently.
//
// A missing table (migration not pasted yet) DEGRADES: every credit then
// reads as awaiting confirmation, so nothing pays unconfirmed -- the safe
// direction -- and `available: false` travels so a screen can say why. Any
// other error is loud.
import { isMissingTable } from "@/lib/constants";
import { decisionKey } from "@/lib/review-bonus";

export async function loadCreditDecisions(supabase) {
  var { data, error } = await supabase.from("review_credit_decisions")
    .select("review_item_id,employee_name,status,decided_by,decided_at").limit(20000);
  if (error && isMissingTable(error)) {
    return { available: false, map: null, note: "review_credit_decisions does not exist yet — run sql/migration_review_credit_decisions.sql. Until then every named credit waits for confirmation." };
  }
  if (error) throw new Error("review_credit_decisions: " + error.message);
  var map = {};
  (data || []).forEach(function(d) {
    map[decisionKey(d.review_item_id, d.employee_name)] = { status: d.status, decided_by: d.decided_by, decided_at: d.decided_at };
  });
  return { available: true, map: map, note: null };
}
