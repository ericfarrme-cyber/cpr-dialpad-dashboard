import { NextResponse } from "next/server";
import { getDailyCallVolume, getHourlyMissed, getDOWMissed, getCallbackData, getCallRecords, getCallSyncState, getStoreClosures } from "@/lib/supabase";
import { indexClosures, isOutsideHours, isOutsideRegularHours, isNeverRangHangup, callLocalDay, callLocalTime } from "@/lib/store-closures";

// GET /api/dialpad/stored — returns all dashboard data from Supabase
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const daysBack = parseInt(searchParams.get("days") || "30");
  const store = searchParams.get("store");

  try {
    const [dailyRaw, missedRaw, dowRaw, callbackRaw, callRecords, syncState, closureRows] = await Promise.all([
      getDailyCallVolume(daysBack),
      getHourlyMissed(daysBack),
      getDOWMissed(daysBack),
      getCallbackData(daysBack),
      getCallRecords({ store, daysBack, limit: 5000 }),
      getCallSyncState(),
      getStoreClosures(daysBack),
    ]);
    // Early closes Dialpad never saw — same rule the answer-rate bonus uses, so
    // the dashboard and the bonus can never disagree about a holiday.
    const closureIdx = indexClosures(closureRows);

    // Build daily call volume from TWO sources:
    // 1. dailyRaw (getDailyCallVolume) — has total and answered per day per store
    // 2. missedRaw (getHourlyMissed) — individual missed call records with timestamps
    // We count missedRaw per day per store to get accurate daily missed counts.
    //
    // AFTER-HOURS HANDLING: Dialpad tags each call with an `availability` value
    // reflecting the department's configured business hours. Missed calls that
    // arrived while the store was "closed" are NOT a performance failure, so we
    // split them out: they are kept in a separate `*_after_hours_missed` stat
    // and EXCLUDED from `*_missed` (and therefore from `*_total` and the answer
    // rate). Open-hours missed calls behave exactly as before.
    function isClosed(row) {
      if (String(row.availability || "").toLowerCase() === "closed") return true;
      // A BLANK availability tag is not "open" — it means Dialpad never judged
      // the call, and those rows also carry a UTC clock rather than the store's
      // local one. Untagged rows are judged against the store's regular hours
      // instead; tagged rows are untouched. See lib/store-closures.js.
      if (isOutsideRegularHours(row.store, row.date_started, row.availability)) return true;
      return isOutsideHours(closureIdx, row.store, row.date_started, row.availability);
    }

    // Count missed calls per day per store from missedRaw, split open vs closed
    const dailyMissedOpen = {};
    const dailyAfterHours = {};
    // Callers who hung up before any phone rang (from 2026-11). Out of the
    // missed count and the rate, same rule as the bonus, still reported.
    const dailyNeverRang = {};
    for (const row of missedRaw) {
      if (!row.date_started || !row.store) continue;
      // The store's calendar day, not the UTC one: an untagged row stores a UTC
      // instant, so bucketing it raw files a 7pm call under tomorrow.
      const dateStr = callLocalDay(row.date_started, row.availability);
      if (!dateStr) continue;
      const key = dateStr + "|" + row.store;
      if (isClosed(row)) {
        dailyAfterHours[key] = (dailyAfterHours[key] || 0) + 1;
      } else if (isNeverRangHangup(row)) {
        dailyNeverRang[key] = (dailyNeverRang[key] || 0) + 1;
      } else {
        dailyMissedOpen[key] = (dailyMissedOpen[key] || 0) + 1;
      }
    }

    // Build daily data from dailyRaw, inject accurate missed from missedRaw
    const dailyMap = {};
    for (const row of dailyRaw) {
      const dateStr = row.call_date;
      if (!dailyMap[dateStr]) {
        dailyMap[dateStr] = { date: dateStr };
        ["fishers","bloomington","indianapolis"].forEach(s => {
          dailyMap[dateStr][`${s}_total`] = 0;
          dailyMap[dateStr][`${s}_answered`] = 0;
          dailyMap[dateStr][`${s}_missed`] = 0;
          dailyMap[dateStr][`${s}_after_hours_missed`] = 0;
          dailyMap[dateStr][`${s}_never_rang`] = 0;
        });
      }
      const answered = row.answered || 0;
      const key = dateStr + "|" + row.store;
      const missedOpen = dailyMissedOpen[key] || 0;
      const afterHours = dailyAfterHours[key] || 0;
      dailyMap[dateStr][`${row.store}_answered`] = answered;
      dailyMap[dateStr][`${row.store}_missed`] = missedOpen;
      dailyMap[dateStr][`${row.store}_after_hours_missed`] = afterHours;
      dailyMap[dateStr][`${row.store}_never_rang`] = dailyNeverRang[key] || 0;
      // Total and answer rate use OPEN-hours missed only.
      dailyMap[dateStr][`${row.store}_total`] = answered + missedOpen;
    }
    
    // Also add days that only appear in missedRaw (in case dailyRaw missed them)
    for (const row of missedRaw) {
      if (!row.date_started || !row.store) continue;
      const dateStr = callLocalDay(row.date_started, row.availability);
      if (!dateStr) continue;
      if (!dailyMap[dateStr]) {
        dailyMap[dateStr] = { date: dateStr };
        ["fishers","bloomington","indianapolis"].forEach(s => {
          dailyMap[dateStr][`${s}_total`] = 0;
          dailyMap[dateStr][`${s}_answered`] = 0;
          dailyMap[dateStr][`${s}_missed`] = 0;
          dailyMap[dateStr][`${s}_after_hours_missed`] = 0;
          dailyMap[dateStr][`${s}_never_rang`] = 0;
        });
      }
      // Ensure open-missed + after-hours counts are set from the split maps
      const key = dateStr + "|" + row.store;
      dailyMap[dateStr][`${row.store}_missed`] = dailyMissedOpen[key] || 0;
      dailyMap[dateStr][`${row.store}_after_hours_missed`] = dailyAfterHours[key] || 0;
      dailyMap[dateStr][`${row.store}_never_rang`] = dailyNeverRang[key] || 0;
      // Total includes OPEN-hours missed only
      dailyMap[dateStr][`${row.store}_total`] = (dailyMap[dateStr][`${row.store}_answered`] || 0) + (dailyMap[dateStr][`${row.store}_missed`] || 0);
    }

    const dailyCalls = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));

    // Per-store aggregate stats
    const storePerf = ["fishers", "bloomington", "indianapolis"].map(s => {
      let total = 0, answered = 0, missed = 0, afterHoursMissed = 0, neverRang = 0;
      dailyCalls.forEach(d => {
        total += d[`${s}_total`] || 0;
        answered += d[`${s}_answered`] || 0;
        missed += d[`${s}_missed`] || 0;
        afterHoursMissed += d[`${s}_after_hours_missed`] || 0;
        neverRang += d[`${s}_never_rang`] || 0;
      });
      return { store: s, total_calls: total, answered, missed, after_hours_missed: afterHoursMissed, never_rang: neverRang, answer_rate: total > 0 ? Math.round(answered / total * 100) : 0 };
    });

    // Transform hourly missed into dashboard format
    const hourlyMap = {};
    for (let h = 8; h <= 20; h++) {
      const label = h <= 12 ? `${h}AM` : `${h-12}PM`;
      hourlyMap[h] = { hour: label, fishers: 0, bloomington: 0, indianapolis: 0 };
    }
    for (const row of missedRaw) {
      // Same clock rule as the counts above. `new Date(x).getHours()` also read
      // the SERVER's zone, which only ever worked because Vercel runs in UTC.
      const lt = callLocalTime(row.date_started, row.availability);
      const h = lt ? parseInt(lt.hhmm.slice(0, 2), 10) : -1;
      if (hourlyMap[h] && row.store) {
        hourlyMap[h][row.store] = (hourlyMap[h][row.store] || 0) + 1;
      }
    }
    const hourlyMissed = Object.values(hourlyMap);

    // Transform DOW missed
    const dowNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const dowMap = {};
    dowNames.forEach(d => { dowMap[d] = { day: d, fishers: 0, bloomington: 0, indianapolis: 0 }; });
    for (const row of dowRaw) {
      // getDOWMissed does not select availability, so these read as tagged —
      // correct for the 39,132 tagged rows and off by one day only for an
      // untagged call after 7pm. Pass availability here if that ever matters.
      const lt = callLocalTime(row.date_started, "open");
      const dayName = lt ? dowNames[lt.dow] : null;
      if (dayName && dowMap[dayName] && row.store) {
        dowMap[dayName][row.store] = (dowMap[dayName][row.store] || 0) + 1;
      }
    }
    const dowData = dowNames.map(d => dowMap[d]);

    // Transform callback data
    const stores = ["fishers", "bloomington", "indianapolis"];
    const callbackResult = stores.map(s => {
      const storeMissed = (callbackRaw.missed || []).filter(m => m.store === s);
      const storeOutbound = (callbackRaw.outbound || []).filter(o => o.store === s);

      let within30 = 0, within60 = 0, later = 0, never = 0;
      for (const m of storeMissed) {
        const callback = storeOutbound.find(o =>
          o.external_number === m.external_number &&
          new Date(o.date_started) > new Date(m.date_started)
        );
        if (!callback) { never++; continue; }
        const diff = (new Date(callback.date_started) - new Date(m.date_started)) / 60000;
        if (diff <= 30) within30++;
        else if (diff <= 60) within60++;
        else later++;
      }

      const calledBack = within30 + within60 + later;
      return { store: s, missed: storeMissed.length, calledBack, within30, within60, later, never };
    });

    // Problem calls (short calls, after-hours, etc)
    const problemTypes = [
      { type: "Short calls (< 1 min)", fn: r => r.is_answered && r.talk_duration && r.talk_duration < 1 },
      { type: "After hours missed", fn: r => r.is_missed && r.availability === "closed" },
      { type: "Long ring (> 30s)", fn: r => r.ringing_duration && r.ringing_duration > 0.5 },
      { type: "Voicemail", fn: r => r.is_voicemail },
      { type: "Abandoned", fn: r => r.is_abandoned },
    ];
    const problemCalls = problemTypes.map(pt => {
      const row = { type: pt.type };
      stores.forEach(s => {
        row[s] = callRecords.filter(r => r.store === s && pt.fn(r)).length;
      });
      return row;
    });

    // Last sync info
    const lastSync = syncState.reduce((latest, s) => {
      if (!latest || new Date(s.last_sync_at) > new Date(latest.last_sync_at)) return s;
      return latest;
    }, null);

    return NextResponse.json({
      success: true,
      hasData: dailyCalls.length > 0,
      lastSync: lastSync?.last_sync_at || null,
      data: {
        dailyCalls,
        storePerf,
        hourlyMissed,
        dowData,
        callbackData: callbackResult,
        problemCalls,
        rawRecordCount: callRecords.length,
      },
    });
  } catch (err) {
    console.error("Stored data fetch error:", err);
    return NextResponse.json({ success: false, error: err.message });
  }
}
