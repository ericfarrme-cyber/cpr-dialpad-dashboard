// "Which page should I ask for a review on?" — answered from the work the
// person actually closed.
//
// WHY THIS EXISTS, and why it does not wait on the review bonus: nine
// department pages exist that a customer has no way to find from the store
// listing, and until now neither did a technician. The "Make It Easy" tip two
// cards below has said "text them the direct review link" since it was
// written, with no link anywhere in the app to text.
//
// Precedent that a dashboard nudge alone moves behaviour, with no money
// attached: warranty mentions went 12.4% -> 24.2% after the free-closers strip
// (z=3.77, p<0.001).
//
// Reads `google-tracking?action=ask_pages`. Counts and links only, and
// DELIBERATELY NO DOLLAR FIGURES: the route returns `named_amount` ($20 while
// a page is under ten reviews, $10 after), but the review bonus is not
// approved, and a number on a technician's own screen reads as a promise of
// pay. "Still under 10 reviews" carries the same ranking without promising
// anything. Put the money here only once Eric signs the bonus off.
"use client";

import { useState } from "react";
import { STORES } from "@/lib/constants";

var TYPE_LABEL = {
  main: "Phone repair",
  computers: "Computer repair",
  consoles: "Console repair",
  electronics: "Electronics",
};

export default function ReviewAskCard({ data, card, cardInner }) {
  var [copied, setCopied] = useState(null);

  if (!data || !data.success) return null;
  var pages = data.pages || [];
  var meta = data.meta || {};

  if (!pages.length) {
    return (
      <div style={Object.assign({}, card, { marginBottom: 20 })}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", marginBottom: 6 }}>
          Where to ask for a review
        </div>
        <div style={{ color: "var(--text-muted)", fontSize: 12, lineHeight: 1.6 }}>
          No closed tickets in the last {meta.window_days || (data.window && data.window.days) || 30} days to point at a page yet.
          {meta.uncategorised ? " " + meta.uncategorised + " ticket" + (meta.uncategorised === 1 ? "" : "s") + " had no device type recorded." : ""}
        </div>
      </div>
    );
  }

  var copy = function(url, key) {
    try {
      navigator.clipboard.writeText(url);
      setCopied(key);
      setTimeout(function() { setCopied(null); }, 1800);
    } catch (e) {
      // Clipboard can be blocked; the link itself is still right there as an
      // anchor, so this is a convenience failing, not the feature failing.
      setCopied("blocked");
    }
  };

  // All nine department pages sit under ten reviews today, so "still worth
  // more" is true for every one of them and says nothing on its own. What
  // separates them is how empty the page is, so that is what leads each row.
  var thin = pages.filter(function(p) { return p.still_worth_more; });

  return (
    <div style={Object.assign({}, card, { marginBottom: 20 })}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8, marginBottom: 4 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>Where to ask for a review</div>
        <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
          your closed tickets, last {(data.window && data.window.days) || 30} days
        </div>
      </div>
      <div style={{ color: "var(--text-muted)", fontSize: 11, lineHeight: 1.6, marginBottom: 14 }}>
        We have four Google pages per store, not one. A console review on the console page is worth more
        than the same review on the main page — and a customer has no way to find it unless you send them the link.
        {thin.length > 0 && (
          <span style={{ color: "var(--yellow)" }}>
            {" "}{thin.length} of these {thin.length === 1 ? "page is" : "pages are"} still under 10 reviews.
          </span>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {pages.map(function(p) {
          var key = p.store + "|" + p.listing_type;
          var st = STORES[p.store];
          var color = st ? st.color : "var(--text-secondary)";
          return (
            <div key={key} style={Object.assign({}, cardInner, {
              display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
              borderLeft: "3px solid " + (p.still_worth_more ? "var(--yellow)" : "var(--border)"),
            })}>
              <div style={{ minWidth: 190, flex: "1 1 190px" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>
                  {TYPE_LABEL[p.listing_type] || p.listing_type}
                </div>
                <div style={{ fontSize: 10, color: color, fontWeight: 600, display: "flex", alignItems: "center", gap: 5, marginTop: 2 }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: color }} />
                  {st ? st.name.replace("CPR ", "") : p.store}
                </div>
              </div>

              <div style={{ minWidth: 92 }}>
                <div style={{ fontSize: 17, fontWeight: 800, color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}>{p.tickets}</div>
                <div style={{ fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>you closed</div>
              </div>

              <div style={{ minWidth: 112 }}>
                <div style={{ fontSize: 17, fontWeight: 800, color: p.total_reviews === 0 ? "var(--yellow)" : "var(--text-secondary)", fontVariantNumeric: "tabular-nums" }}>
                  {p.total_reviews === null || p.total_reviews === undefined ? "—" : p.total_reviews}
                </div>
                <div style={{ fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>
                  {p.total_reviews === 0 ? "never reviewed" : "reviews on the page"}
                </div>
              </div>

              <div style={{ display: "flex", gap: 6, marginLeft: "auto", flexWrap: "wrap" }}>
                {p.write_review_url ? (
                  <>
                    <a href={p.write_review_url} target="_blank" rel="noopener noreferrer"
                      style={{
                        padding: "7px 13px", borderRadius: 7, textDecoration: "none",
                        background: "linear-gradient(135deg,var(--purple),var(--cyan))", color: "#FFF",
                        fontSize: 11, fontWeight: 700, whiteSpace: "nowrap",
                      }}>
                      Open review page
                    </a>
                    <button onClick={function() { copy(p.write_review_url, key); }}
                      style={{
                        padding: "7px 12px", borderRadius: 7, cursor: "pointer",
                        border: "1px solid var(--border)", background: "transparent",
                        color: copied === key ? "var(--green)" : "var(--text-secondary)",
                        fontSize: 11, fontWeight: 700, whiteSpace: "nowrap",
                        fontFamily: "'Space Grotesk',sans-serif",
                      }}>
                      {copied === key ? "Copied" : copied === "blocked" ? "Copy blocked" : "Copy link"}
                    </button>
                  </>
                ) : (
                  // Never a dead button: a page with no place_id has no review
                  // URL, and saying so beats a link that goes nowhere.
                  <span style={{ fontSize: 10, color: "var(--text-muted)" }}>no link for this page yet</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {meta.uncategorised > 0 && (
        <div style={{ marginTop: 10, fontSize: 10, color: "var(--text-muted)", lineHeight: 1.6 }}>
          {meta.uncategorised} of your {meta.tickets_matched} tickets have no device type recorded, so they
          cannot point at a page. That is a gap in how the ticket was graded, not in your work.
        </div>
      )}
      <div style={{ marginTop: 8, fontSize: 10, color: "var(--text-muted)" }}>
        Never offer a discount for a review — Google asks the customer whether they were paid for it and
        hides the review if they say yes.
      </div>
    </div>
  );
}
