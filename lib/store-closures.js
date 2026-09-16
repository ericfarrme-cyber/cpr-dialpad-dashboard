// Closed and early-close days, and the holidays worth asking about in advance.
//
// Dialpad already tags a call `availability = "closed"` from the department's
// configured hours, and a missed call tagged closed never enters the answer
// rate. That fails only when Dialpad did not know — a holiday early close that
// nobody put in the schedule. `store_closures` records what the stores
// actually did, and `isOutsideHours` applies it to a missed call.
//
// ⚠ TIME: call_records.date_started is timestamptz, but the clock value stored
// is the store's local time (a call at 4:12pm in Fishers reads 16:12+00). So
// the comparison below uses the raw clock reading and never converts zones.
// Converting would shift every call four hours and silently mis-scope a close.

export var HOLIDAY_NAMES = {
  "01-01": "New Year's Day",
  "07-04": "Independence Day",
  "12-24": "Christmas Eve",
  "12-25": "Christmas Day",
  "12-31": "New Year's Eve",
};

function nthWeekday(year, month, weekday, n) {
  // month 1-12, weekday 0=Sun; n = 1..5
  var d = new Date(Date.UTC(year, month - 1, 1));
  var shift = (weekday - d.getUTCDay() + 7) % 7;
  d.setUTCDate(1 + shift + (n - 1) * 7);
  return d.toISOString().slice(0, 10);
}
function lastWeekday(year, month, weekday) {
  var d = new Date(Date.UTC(year, month, 0)); // last day of month
  var shift = (d.getUTCDay() - weekday + 7) % 7;
  d.setUTCDate(d.getUTCDate() - shift);
  return d.toISOString().slice(0, 10);
}

// Days the stores have historically closed early or entirely. Black Friday is
// deliberately absent — it is a trading day, not a closure.
export function holidaysFor(year) {
  var thanksgiving = nthWeekday(year, 11, 4, 4);
  var out = [
    { date: year + "-01-01", name: "New Year's Day" },
    { date: lastWeekday(year, 5, 1), name: "Memorial Day" },
    { date: year + "-07-04", name: "Independence Day" },
    { date: nthWeekday(year, 9, 1, 1), name: "Labor Day" },
    { date: thanksgiving, name: "Thanksgiving" },
    { date: year + "-12-24", name: "Christmas Eve" },
    { date: year + "-12-25", name: "Christmas Day" },
    { date: year + "-12-31", name: "New Year's Eve" },
  ];
  return out.sort(function(a, b) { return a.date < b.date ? -1 : 1; });
}

// Holidays inside the next `days` days, this year or next.
export function upcomingHolidays(fromYmd, days) {
  var start = new Date(fromYmd + "T00:00:00Z");
  var end = new Date(start); end.setUTCDate(end.getUTCDate() + (days || 14));
  var endS = end.toISOString().slice(0, 10);
  var y = start.getUTCFullYear();
  return holidaysFor(y).concat(holidaysFor(y + 1)).filter(function(h) {
    return h.date >= fromYmd && h.date <= endS;
  }).map(function(h) {
    return Object.assign({}, h, { days_away: Math.round((new Date(h.date + "T00:00:00Z") - start) / 86400000) });
  });
}

// Index closure rows for O(1) lookup: "store|YYYY-MM-DD" -> row.
export function indexClosures(rows) {
  var m = {};
  (rows || []).forEach(function(r) { m[r.store + "|" + String(r.closure_date).slice(0, 10)] = r; });
  return m;
}

// Was this call outside the hours the store actually kept that day?
// `dateStarted` is a call_records timestamp; see the TIME note above.
export function isOutsideHours(index, store, dateStarted) {
  if (!dateStarted) return false;
  var iso = typeof dateStarted === "string" ? dateStarted : new Date(dateStarted).toISOString();
  var day = iso.slice(0, 10);
  var hhmm = iso.slice(11, 16);
  var c = index[store + "|" + day];
  if (!c) return false;
  if (!c.closes_at && !c.opens_at) return true;                       // closed all day
  if (c.closes_at && hhmm >= String(c.closes_at).slice(0, 5)) return true;  // after an early close
  if (c.opens_at && hhmm < String(c.opens_at).slice(0, 5)) return true;     // before a late open
  return false;
}
