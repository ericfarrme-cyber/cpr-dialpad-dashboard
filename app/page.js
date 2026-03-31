'use client';

import AuthProvider from "@/components/AuthProvider";
import ErrorBoundary from "@/components/ErrorBoundary";
import DialpadDashboard from "@/components/DialpadDashboard";

export default function Home() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <DialpadDashboard />
      </AuthProvider>
    </ErrorBoundary>
  );
}
