import { NextResponse } from "next/server";
import { getDailyCallVolume, getHourlyMissed, getDOWMissed, getCallbackData, getCallRecords, getCallSyncState } from "@/lib/supabase";

// GET /api/dialpad/stored — returns all dashboard data from Supabase
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const daysBack = parseInt(searchParams.get("days") || "30");
  const store = searchParams.get("store");

  try {
    const [dailyRaw, missedRaw, dowRaw, callbackRaw, callRecords, syncState] = await Promise.all([
      getDailyCallVolume(daysBack),
      getHourlyMissed(daysBack),
      getDOWMissed(daysBack),
      getCallbackData(daysBack),
      getCallRecords({ store, daysBack, limit: 2000 }),
      getCallSyncState(),
    ]);

    // Transform daily volume into dashboard format
    const dailyMap = {};
    for (const row of dailyRaw) {
      const dateStr = row.call_date;
      if (!dailyMap[dateStr]) {
        dailyMap[dateStr] = { date: dateStr };
      }
      dailyMap[dateStr][`${row.store}_total`] = row.total;
      dailyMap[dateStr][`${row.store}_answered`] = row.answered;
      dailyMap[dateStr][`${row.store}_missed`] = row.missed || 0;
    }
    const dailyCalls = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));

    // Transform hourly missed into dashboard format
    const hourlyMap = {};
    for (let h = 8; h <= 20; h++) {
      const label = h <= 12 ? `${h}AM` : `${h-12}PM`;
      hourlyMap[h] = { hour: label, fishers: 0, bloomington: 0, indianapolis: 0 };
    }
    for (const row of missedRaw) {
      const h = new Date(row.date_started).getHours();
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
      const d = new Date(row.date_started);
      const dayName = dowNames[d.getDay()];
      if (dowMap[dayName] && row.store) {
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
