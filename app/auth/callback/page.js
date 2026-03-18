'use client';

import { useEffect } from "react";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

export default function AuthCallback() {
  useEffect(function() {
    var supabase = getSupabaseBrowser();

    // Handle the OAuth callback — Supabase will exchange the code for a session
    supabase.auth.onAuthStateChange(function(event, session) {
      if (event === "SIGNED_IN" && session) {
        // Redirect to dashboard
        window.location.href = "/";
      }
    });

    // Also try to get session directly (handles hash fragment tokens)
    supabase.auth.getSession().then(function(result) {
      if (result.data.session) {
        window.location.href = "/";
      }
    });
  }, []);

  return (
    <div style={{ minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"#0B0D11",color:"#F0F1F3",fontFamily:"-apple-system,sans-serif" }}>
      <div style={{ textAlign:"center" }}>
        <div style={{ width:40,height:40,margin:"0 auto 16px",border:"3px solid #7B2FFF",borderTopColor:"transparent",borderRadius:"50%",animation:"spin 1s linear infinite" }} />
        <div style={{ fontSize:14 }}>Completing sign in...</div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}
