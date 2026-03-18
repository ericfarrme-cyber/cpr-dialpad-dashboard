'use client';

import AuthProvider from "@/components/AuthProvider";
import DialpadDashboard from "@/components/DialpadDashboard";

export default function Home() {
  return (
    <AuthProvider>
      <DialpadDashboard />
    </AuthProvider>
  );
}
