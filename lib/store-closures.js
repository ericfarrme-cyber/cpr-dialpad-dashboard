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

// ⚠⚠ TWO WRITERS PUT TWO DIFFERENT CLOCKS IN THE SAME COLUMN.
//
// 39,132 rows carry an `availability` tag ("open" / "closed") and store the
// STORE'S LOCAL clock wearing a +00 offset — the TIME note above. 1,194 rows
// carry a BLANK tag and store a TRUE UTC instant. The split is exact: across
// all 40,369 rows, **no tagged row is ever blank and no blank row is ever
// tagged**, so the tag alone says which clock you are holding. Nothing has to
// sniff timestamp precision.
//
// Proved by causality, not by eye: the Fishers row of 2026-11-05 reads
// 06:52:40Z with `created_at` 07:02:21Z. Read as local it would have been
// written five hours before the call happened, which is impossible — so it is
// UTC, and the call was at **01:52 ET**. It showed on the shop TV as a missed
// call against an empty store because `isClosed()` only ever excluded a call
// Dialpad itself tagged "closed", and an untagged one fell through to "open".
//
// Anything new that reads `date_started` must go through `callLocalTime()`.

// Regular hours per store, Sun..Sat. NOT invented and NOT typed from memory:
// read off the rows Dialpad itself tagged `availability = "open"` over three
// months (Aug-Nov 2026, 14,000+ calls), then rounded out to the hour the tags
// imply. Fishers Mon-Fri ran 09:00-18:59 observed; Bloomington and Indianapolis
// open an hour later and both cut Sunday short.
export var STORE_HOURS = {
  fishers:      { 0: ["10:00", "18:00"], 1: ["09:00", "19:00"], 2: ["09:00", "19:00"], 3: ["09:00", "19:00"], 4: ["09:00", "19:00"], 5: ["09:00", "19:00"], 6: ["10:00", "19:00"] },
  bloomington:  { 0: ["11:00", "17:00"], 1: ["10:00", "19:00"], 2: ["10:00", "19:00"], 3: ["10:00", "19:00"], 4: ["10:00", "19:00"], 5: ["10:00", "19:00"], 6: ["10:00", "19:00"] },
  indianapolis: { 0: ["11:00", "17:00"], 1: ["10:00", "19:00"], 2: ["10:00", "19:00"], 3: ["10:00", "19:00"], 4: ["10:00", "19:00"], 5: ["10:00", "19:00"], 6: ["10:00", "19:00"] },
};

// A call's real local time at the store, whichever writer produced the row.
// Returns { ymd, hhmm, dow, converted } — `converted` is true when the stored
// value was a UTC instant we had to shift (DST handled by the tz database, so
// a June row moves 4 hours and a December row 5).
export function callLocalTime(dateStarted, availability) {
  if (!dateStarted) return null;
  var tagged = String(availability === null || availability === undefined ? "" : availability).trim() !== "";
  if (tagged) {
    // Already the store's local clock. Read the digits; never convert, or every
    // call shifts and every early close is mis-scoped.
    var iso = typeof dateStarted === "string" ? dateStarted : new Date(dateStarted).toISOString();
    var ymd = iso.slice(0, 10);
    return { ymd: ymd, hhmm: iso.slice(11, 16), dow: new Date(ymd + "T12:00:00Z").getUTCDay(), converted: false };
  }
  var d = dateStarted instanceof Date ? dateStarted : new Date(dateStarted);
  if (isNaN(d.getTime())) return null;
  var parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Indiana/Indianapolis",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d).reduce(function(a, p) { a[p.type] = p.value; return a; }, {});
  var lymd = parts.year + "-" + parts.month + "-" + parts.day;
  // en-CA gives "24" for midnight in some ICU builds; normalise it.
  var hh = parts.hour === "24" ? "00" : parts.hour;
  return { ymd: lymd, hhmm: hh + ":" + parts.minute, dow: new Date(lymd + "T12:00:00Z").getUTCDay(), converted: true };
}

// The calendar day a call belongs to, at the store. Use this for day buckets:
// bucketing an untagged row by its UTC date files a 7pm call under tomorrow.
export function callLocalDay(dateStarted, availability) {
  var t = callLocalTime(dateStarted, availability);
  return t ? t.ymd : null;
}

// Was this call outside the store's REGULAR hours?
//
// Deliberately a FALLBACK ONLY: where Dialpad tagged the call, its tag is the
// answer and this returns false, so not one of the 39,132 tagged rows changes
// classification and no past month's answer rate can be restated. It decides
// only the untagged rows, which Dialpad never judged at all. Same direction as
// the forward-only short-call rule — never take money back on a number we did
// not stand behind at the time.
export function isOutsideRegularHours(store, dateStarted, availability) {
  if (String(availability === null || availability === undefined ? "" : availability).trim() !== "") return false;
  var t = callLocalTime(dateStarted, availability);
  if (!t) return false;
  var hours = STORE_HOURS[store];
  if (!hours) return false;           // unknown store: never guess it closed
  var win = hours[t.dow];
  if (!win) return false;
  return t.hhmm < win[0] || t.hhmm >= win[1];
}

// Was this call outside the hours the store actually kept that day?
// `dateStarted` is a call_records timestamp; see the TIME note above.
export function isOutsideHours(index, store, dateStarted, availability) {
  if (!dateStarted) return false;
  // availability is optional so existing 3-argument callers keep working: with
  // it omitted a row reads as tagged, which is what every caller passed before.
  var t = callLocalTime(dateStarted, arguments.length > 3 ? availability : "open");
  if (!t) return false;
  var day = t.ymd;
  var hhmm = t.hhmm;
  var c = index[store + "|" + day];
  if (!c) return false;
  if (!c.closes_at && !c.opens_at) return true;                       // closed all day
  if (c.closes_at && hhmm >= String(c.closes_at).slice(0, 5)) return true;  // after an early close
  if (c.opens_at && hhmm < String(c.opens_at).slice(0, 5)) return true;     // before a late open
  return false;
}
