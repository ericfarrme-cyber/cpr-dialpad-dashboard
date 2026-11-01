// Shared "open the TV dashboard" link. One component so every page points at
// the same URL shape and a store can never be sent to another store's board.
//
// /tv is public and unauthenticated by design (it hangs on a wall), so this is
// only a convenience -- but it is the convenience open item 17 asked for: until
// now the only way onto the board was for somebody to remember the query string.
//
// Given a store it renders one link to that store's board. Given "all" (or
// nothing) it renders a picker, because "All Stores" has no single board and
// guessing one would put the wrong store's numbers on a screen.
"use client";

import { useState } from "react";
import { STORES, STORE_KEYS } from "@/lib/constants";

export function tvUrl(store) {
  return "/tv?store=" + encodeURIComponent(String(store || "").toLowerCase());
}

function shortName(key) {
  var s = STORES[key];
  return s ? s.name.replace("CPR ", "") : key;
}

// Opens in a new tab on purpose: the board is meant to be left up on a second
// screen, and nobody wants to lose the dashboard they were working in.
function Anchor({ store, label, color, size, style }) {
  var sm = size === "sm";
  return (
    <a
      href={tvUrl(store)}
      target="_blank"
      rel="noopener noreferrer"
      title={"Open the " + shortName(store) + " TV dashboard in a new tab"}
      style={Object.assign({
        padding: sm ? "6px 12px" : "8px 14px",
        borderRadius: sm ? 6 : 8,
        border: "1px solid " + (color || "var(--border)"),
        background: (color || "var(--border)") + "14",
        color: color || "var(--text-secondary)",
        fontSize: sm ? 10 : 12,
        fontWeight: 700,
        textDecoration: "none",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        whiteSpace: "nowrap",
      }, style || {})}
    >
      <span style={{ fontSize: sm ? 12 : 14 }}>{"📺"}</span>
      {label}
    </a>
  );
}

export default function TVLink({ store, size, style, label }) {
  var [open, setOpen] = useState(false);
  var key = String(store || "").toLowerCase();
  var sm = size === "sm";

  if (STORES[key]) {
    return <Anchor store={key} label={label || (shortName(key) + " TV")} color={STORES[key].color} size={size} style={style} />;
  }

  // No single store in view -- offer the three boards rather than defaulting to
  // one. /tv itself defaults to Fishers, which is fine for a bookmark and wrong
  // for a button somebody clicks while looking at all three.
  return (
    <div style={Object.assign({ position: "relative", display: "inline-block" }, style || {})}>
      <button
        onClick={function() { setOpen(!open); }}
        style={{
          padding: sm ? "6px 12px" : "8px 14px",
          borderRadius: sm ? 6 : 8,
          border: "1px solid var(--border)",
          background: "transparent",
          color: "var(--text-secondary)",
          fontSize: sm ? 10 : 12,
          fontWeight: 700,
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          whiteSpace: "nowrap",
          fontFamily: "'Space Grotesk',sans-serif",
        }}
      >
        <span style={{ fontSize: sm ? 12 : 14 }}>{"📺"}</span>
        {label || "TV Dashboard"}
        <span style={{ fontSize: 9, opacity: 0.7 }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 50,
          background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10,
          padding: 8, display: "flex", flexDirection: "column", gap: 6,
          boxShadow: "0 8px 24px rgba(0,0,0,0.25)", minWidth: 170,
        }}>
          <div style={{ fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.6, padding: "2px 4px" }}>
            Open a store's board
          </div>
          {STORE_KEYS.map(function(k) {
            return (
              <a key={k} href={tvUrl(k)} target="_blank" rel="noopener noreferrer"
                onClick={function() { setOpen(false); }}
                style={{
                  display: "flex", alignItems: "center", gap: 8, textDecoration: "none",
                  padding: "7px 10px", borderRadius: 7, border: "1px solid " + STORES[k].color + "44",
                  background: STORES[k].color + "0D", color: STORES[k].color,
                  fontSize: 11, fontWeight: 700, whiteSpace: "nowrap",
                }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: STORES[k].color }} />
                {shortName(k)}
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
