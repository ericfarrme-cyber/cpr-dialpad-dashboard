'use client';

import { useState, useEffect, createContext, useContext } from "react";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

var AuthContext = createContext(null);

export function useAuth() {
  return useContext(AuthContext);
}

export default function AuthProvider({ children }) {
  var [user, setUser] = useState(null);
  var [role, setRole] = useState(null);
  var [userInfo, setUserInfo] = useState(null);
  var [loading, setLoading] = useState(true);
  var [accessToken, setAccessToken] = useState(null);

  var supabase = getSupabaseBrowser();

  useEffect(function() {
    // Check current session
    supabase.auth.getSession().then(function(result) {
      var session = result.data.session;
      if (session) {
        setUser(session.user);
        setAccessToken(session.access_token);
        checkRole(session.user.email, session.access_token);
      } else {
        setLoading(false);
      }
    });

    // Listen for auth changes
    var { data: listener } = supabase.auth.onAuthStateChange(function(event, session) {
      if (session) {
        setUser(session.user);
        setAccessToken(session.access_token);
        checkRole(session.user.email, session.access_token);
      } else {
        setUser(null);
        setRole(null);
        setUserInfo(null);
        setAccessToken(null);
        setLoading(false);
      }
    });

    return function() { listener.subscription.unsubscribe(); };
  }, []);

  async function checkRole(email, token) {
    try {
      var res = await fetch("/api/auth/me", {
        headers: { "Authorization": "Bearer " + token },
      });
      var json = await res.json();
      if (json.success) {
        setRole(json.role);
        setUserInfo(json);
      } else {
        // User is authenticated but not authorized
        setRole("unauthorized");
        setUserInfo({ error: json.error });
      }
    } catch(e) {
      setRole("unauthorized");
      setUserInfo({ error: "Failed to verify access" });
    }
    setLoading(false);
  }

  var signOut = async function() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  };

  // Helper to make authenticated API calls
  var authFetch = function(url, options) {
    var opts = options || {};
    opts.headers = opts.headers || {};
    if (accessToken) {
      opts.headers["Authorization"] = "Bearer " + accessToken;
    }
    return fetch(url, opts);
  };

  if (loading) {
    return (
      <div style={{ minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"#0B0D11" }}>
        <div style={{ textAlign:"center" }}>
          <div style={{ width:40,height:40,margin:"0 auto 16px",border:"3px solid #7B2FFF",borderTopColor:"transparent",borderRadius:"50%",animation:"spin 1s linear infinite" }} />
          <div style={{ color:"#6B6F78",fontSize:13 }}>Loading...</div>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  // Not logged in
  if (!user) {
    if (typeof window !== "undefined") window.location.href = "/login";
    return null;
  }

  // Logged in but not authorized
  if (role === "unauthorized") {
    return (
      <div style={{ minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"#0B0D11",fontFamily:"-apple-system,sans-serif" }}>
        <div style={{ maxWidth:420,textAlign:"center",padding:20 }}>
          <div style={{ fontSize:48,marginBottom:16 }}>{"\uD83D\uDD12"}</div>
          <h1 style={{ color:"#F0F1F3",fontSize:20,fontWeight:700,margin:"0 0 8px" }}>Access Denied</h1>
          <p style={{ color:"#8B8F98",fontSize:14,margin:"0 0 16px" }}>
            {userInfo && userInfo.error ? userInfo.error : "Your account is not authorized to access this dashboard."}
          </p>
          <p style={{ color:"#6B6F78",fontSize:12,margin:"0 0 24px" }}>
            Signed in as: {user.email}
          </p>
          <button onClick={signOut}
            style={{ padding:"10px 24px",borderRadius:8,border:"1px solid #2A2D35",background:"transparent",color:"#F0F1F3",fontSize:13,cursor:"pointer" }}>
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ user: user, role: role, userInfo: userInfo, accessToken: accessToken, signOut: signOut, authFetch: authFetch }}>
      {children}
    </AuthContext.Provider>
  );
}
