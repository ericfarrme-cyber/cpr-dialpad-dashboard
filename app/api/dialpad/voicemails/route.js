import { NextResponse } from "next/server";
import { getVoicemailData } from "@/lib/supabase";
import { STORES } from "@/lib/constants";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const daysBack = parseInt(searchParams.get("days") || "30");
  const store = searchParams.get("store");

  try {
    const { voicemails, outbound } = await getVoicemailData(daysBack);

    // Build outbound lookup by phone number for fast matching
    var outboundByPhone = {};
    outbound.forEach(function(o) {
      var phone = (o.external_number || "").replace(/\D/g, "").slice(-10);
      if (!phone) return;
      if (!outboundByPhone[phone]) outboundByPhone[phone] = [];
      outboundByPhone[phone].push(o);
    });

    // Process each voicemail
    var processed = voicemails.map(function(vm) {
      var phone = (vm.external_number || "").replace(/\D/g, "").slice(-10);
      var vmTime = new Date(vm.date_started);
      var callback = null;
      var callbackMinutes = null;

      // Find the first outbound call to this number AFTER the voicemail
      var candidates = outboundByPhone[phone] || [];
      for (var i = 0; i < candidates.length; i++) {
        var cbTime = new Date(candidates[i].date_started);
        if (cbTime > vmTime) {
          callback = candidates[i];
          callbackMinutes = (cbTime - vmTime) / 60000;
          break;
        }
      }

      var status = "unreturned";
      if (callback) {
        if (callbackMinutes <= 30) status = "returned_fast";
        else if (callbackMinutes <= 60) status = "returned_ok";
        else status = "returned_late";
      }

      // Check age for urgency flagging
      var ageMinutes = (Date.now() - vmTime.getTime()) / 60000;
      var urgent = !callback && ageMinutes > 60;

      return {
        call_id: vm.call_id,
        date: vm.date_started,
        store: vm.store,
        store_name: vm.store_name || vm.store,
        phone: vm.external_number || "",
        phone_clean: phone,
        talk_duration: vm.talk_duration,
        status: status,
        urgent: urgent,
        age_minutes: Math.round(ageMinutes),
        callback_date: callback ? callback.date_started : null,
        callback_minutes: callbackMinutes ? Math.round(callbackMinutes) : null,
        callback_store: callback ? callback.store : null,
      };
    });

    // Filter by store if specified
    if (store && store !== "all") {
      processed = processed.filter(function(vm) { return vm.store === store; });
    }

    // Compute summary stats
    var storeKeys = Object.keys(STORES);
    var summary = {
      total: processed.length,
      returned: processed.filter(function(v) { return v.status !== "unreturned"; }).length,
      unreturned: processed.filter(function(v) { return v.status === "unreturned"; }).length,
      urgent: processed.filter(function(v) { return v.urgent; }).length,
      avg_callback_min: 0,
      by_store: {},
    };

    var cbTimes = processed.filter(function(v) { return v.callback_minutes; }).map(function(v) { return v.callback_minutes; });
    if (cbTimes.length > 0) {
      summary.avg_callback_min = Math.round(cbTimes.reduce(function(s, m) { return s + m; }, 0) / cbTimes.length);
    }

    storeKeys.forEach(function(sk) {
      var sv = processed.filter(function(v) { return v.store === sk; });
      var returned = sv.filter(function(v) { return v.status !== "unreturned"; });
      summary.by_store[sk] = {
        total: sv.length,
        returned: returned.length,
        unreturned: sv.length - returned.length,
        urgent: sv.filter(function(v) { return v.urgent; }).length,
        rate: sv.length > 0 ? parseFloat(((returned.length / sv.length) * 100).toFixed(1)) : 0,
      };
    });

    return NextResponse.json({
      success: true,
      voicemails: processed,
      summary: summary,
    });
  } catch (err) {
    console.error("Voicemail route error:", err);
    return NextResponse.json({ success: false, error: err.message });
  }
}
