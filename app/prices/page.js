'use client';

// /prices — the repair price book. Reachable by every role (AuthProvider only
// redirects dashboard-less users away from "/"), which is the point: this is
// the page an agent has open while quoting on the phone. Editing is gated to
// admins inside the component and enforced again in the API route.
import AuthProvider from "@/components/AuthProvider";
import ErrorBoundary from "@/components/ErrorBoundary";
import PriceBook from "@/components/PriceBook";

export default function PricesPage() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <PriceBook />
      </AuthProvider>
    </ErrorBoundary>
  );
}
