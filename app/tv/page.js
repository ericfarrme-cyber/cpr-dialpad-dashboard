// Always-on TV dashboard for store backrooms.
// Public URL: /tv?store=fishers (or bloomington, indianapolis)
// No login, no nav chrome, full-screen black background.
// Two rotating screens: DAILY DASH and RANKINGS, 30 sec each.
"use client";

import TVDashboard from "@/components/TVDashboard";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function TVPageInner() {
  var searchParams = useSearchParams();
  var store = (searchParams.get("store") || "fishers").toLowerCase();
  // Validate against known stores; default to fishers if unknown.
  var validStores = ["fishers", "bloomington", "indianapolis"];
  if (validStores.indexOf(store) === -1) store = "fishers";
  return <TVDashboard store={store} />;
}

export default function TVPage() {
  return (
    <div style={{
      position: "fixed", inset: 0,
      background: "#000",
      color: "#F0F1F3",
      overflow: "hidden",
      fontFamily: "'Space Grotesk', system-ui, -apple-system, sans-serif",
    }}>
      <Suspense fallback={<div style={{ padding: 40, fontSize: 24, color: "#8B8F98" }}>Loading...</div>}>
        <TVPageInner />
      </Suspense>
    </div>
  );
}
