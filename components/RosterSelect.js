'use client';

import { useState, useEffect } from "react";

// A <select> of active roster names, for fields that pay or credit a person.
//
// Why it exists: the advanced-repair log's "Repaired By" was free text, and the
// commission and Bonus Ledger read it by name. One person arrived as "Duncan",
// "Duncan Hitti", "Sam", "Sam Tomey"... and Samuel's May 2026 paycheck missed
// $10.37 because "Sam Tomey" did not match him (CONTEXT § 10bh). Picking from the
// roster stops new spellings at the source.
//
// Rules this keeps:
//  - An existing value that is NOT a roster name is shown as-is ("as saved") and
//    stays selected. Opening an old row must never quietly change who it pays.
//  - If the roster cannot load, the field falls back to free text and says so,
//    rather than leaving a form nobody can fill in.

var rosterPromise = null;

function loadRoster() {
  if (!rosterPromise) {
    rosterPromise = fetch("/api/dialpad/roster?action=list")
      .then(function(r) {
        if (!r.ok) throw new Error("roster " + r.status);
        return r.json();
      })
      .then(function(json) {
        if (!json || !json.success || !Array.isArray(json.employees)) {
          throw new Error((json && json.error) || "roster returned no employees");
        }
        var seen = {};
        var names = [];
        json.employees.forEach(function(e) {
          var n = (e.name || "").trim();
          if (n && !seen[n]) { seen[n] = true; names.push(n); }
        });
        return names.sort(function(a, b) { return a.localeCompare(b); });
      })
      .catch(function(e) {
        rosterPromise = null; // let the next form open try again
        throw e;
      });
  }
  return rosterPromise;
}

export default function RosterSelect(props) {
  var value = props.value || "";
  var [names, setNames] = useState(null);
  var [failed, setFailed] = useState(null);

  useEffect(function() {
    var live = true;
    loadRoster()
      .then(function(list) { if (live) setNames(list); })
      .catch(function(e) {
        console.error("[RosterSelect] roster failed to load:", e.message);
        if (live) setFailed(e.message);
      });
    return function() { live = false; };
  }, []);

  if (failed) {
    return (
      <div>
        <input value={value} onChange={function(e) { props.onChange(e.target.value); }} placeholder="Full name, as on the roster" style={props.style} />
        <div style={{ color: "var(--red)", fontSize: 10, marginTop: 4 }}>Couldn’t load the roster, so type the full name.</div>
      </div>
    );
  }

  var offRoster = value && names && names.indexOf(value) === -1;

  return (
    <select value={value} disabled={!names} onChange={function(e) { props.onChange(e.target.value); }} style={props.style}>
      <option value="">{names ? (props.emptyLabel || "— not yet —") : "Loading roster…"}</option>
      {offRoster && <option value={value}>{value} (as saved)</option>}
      {(names || []).map(function(n) { return <option key={n} value={n}>{n}</option>; })}
    </select>
  );
}
