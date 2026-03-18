'use client';

import { useState, useEffect } from "react";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

export default function LoginPage() {
  var [email, setEmail] = useState("");
  var [password, setPassword] = useState("");
  var [loading, setLoading] = useState(false);
  var [error, setError] = useState(null);
  var [mode, setMode] = useState("login"); // login, signup, forgot
  var [message, setMessage] = useState(null);

  var supabase = getSupabaseBrowser();

  // Check if already logged in
  useEffect(function() {
    supabase.auth.getSession().then(function(result) {
      if (result.data.session) {
        window.location.href = "/";
      }
    });
  }, []);

  var handleEmailLogin = async function(e) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    var { data, error: authError } = await supabase.auth.signInWithPassword({
      email: email,
      password: password,
    });

    if (authError) {
      if (authError.message.includes("Invalid login")) {
        setError("Invalid email or password");
      } else if (authError.message.includes("Email not confirmed")) {
        setError("Check your email to confirm your account before logging in");
      } else {
        setError(authError.message);
      }
      setLoading(false);
      return;
    }

    // Check if user is authorized in dashboard_users
    window.location.href = "/";
  };

  var handleGoogleLogin = async function() {
    setLoading(true);
    setError(null);

    var { data, error: authError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin + "/auth/callback",
      },
    });

    if (authError) {
      setError(authError.message);
      setLoading(false);
    }
  };

  var handleForgotPassword = async function(e) {
    e.preventDefault();
    if (!email) { setError("Enter your email address"); return; }
    setLoading(true);
    setError(null);

    var { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + "/auth/callback",
    });

    if (resetError) {
      setError(resetError.message);
    } else {
      setMessage("Password reset email sent. Check your inbox.");
    }
    setLoading(false);
  };

  return (
    <div style={{ minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"#0B0D11",fontFamily:"-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" }}>
      {/* Background gradient */}
      <div style={{ position:"fixed",top:0,left:0,right:0,bottom:0,background:"radial-gradient(ellipse at 30% 20%, #7B2FFF08 0%, transparent 50%), radial-gradient(ellipse at 70% 80%, #00D4FF06 0%, transparent 50%)",pointerEvents:"none" }} />

      <div style={{ position:"relative",width:"100%",maxWidth:420,padding:20 }}>
        {/* Logo and title */}
        <div style={{ textAlign:"center",marginBottom:32 }}>
          <div style={{ width:56,height:56,margin:"0 auto 16px",borderRadius:14,background:"linear-gradient(135deg,#00D4FF,#7B2FFF,#FF2D95)",display:"flex",alignItems:"center",justifyContent:"center" }}>
            <span style={{ color:"#FFF",fontSize:24,fontWeight:900 }}>FT</span>
          </div>
          <h1 style={{ color:"#F0F1F3",fontSize:22,fontWeight:800,margin:0 }}>Focused Technologies</h1>
          <p style={{ color:"#6B6F78",fontSize:13,margin:"6px 0 0" }}>CPR Store Operations Dashboard</p>
        </div>

        {/* Card */}
        <div style={{ background:"#1A1D23",borderRadius:16,padding:32,border:"1px solid #2A2D3544" }}>
          <h2 style={{ color:"#F0F1F3",fontSize:16,fontWeight:700,margin:"0 0 20px",textAlign:"center" }}>
            {mode === "login" ? "Sign In" : mode === "signup" ? "Create Account" : "Reset Password"}
          </h2>

          {/* Google sign-in */}
          {mode !== "forgot" && (
            <button onClick={handleGoogleLogin} disabled={loading}
              style={{ width:"100%",padding:"12px 16px",borderRadius:10,border:"1px solid #2A2D35",background:"#12141A",color:"#F0F1F3",fontSize:14,fontWeight:600,cursor:loading?"wait":"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:10,marginBottom:16,transition:"border-color 0.2s" }}
              onMouseEnter={function(e){e.target.style.borderColor="#7B2FFF";}}
              onMouseLeave={function(e){e.target.style.borderColor="#2A2D35";}}>
              <svg width="18" height="18" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Continue with Google
            </button>
          )}

          {mode !== "forgot" && (
            <div style={{ display:"flex",alignItems:"center",gap:12,margin:"16px 0" }}>
              <div style={{ flex:1,height:1,background:"#2A2D35" }} />
              <span style={{ color:"#6B6F78",fontSize:11 }}>or</span>
              <div style={{ flex:1,height:1,background:"#2A2D35" }} />
            </div>
          )}

          {/* Email form */}
          <form onSubmit={mode === "forgot" ? handleForgotPassword : handleEmailLogin}>
            <div style={{ marginBottom:12 }}>
              <label style={{ color:"#8B8F98",fontSize:11,display:"block",marginBottom:4 }}>Email</label>
              <input type="email" value={email} onChange={function(e){setEmail(e.target.value);}}
                placeholder="you@example.com" required
                style={{ width:"100%",padding:"10px 14px",borderRadius:8,border:"1px solid #2A2D35",background:"#12141A",color:"#F0F1F3",fontSize:14,outline:"none",boxSizing:"border-box" }}
                onFocus={function(e){e.target.style.borderColor="#7B2FFF";}}
                onBlur={function(e){e.target.style.borderColor="#2A2D35";}} />
            </div>

            {mode !== "forgot" && (
              <div style={{ marginBottom:16 }}>
                <label style={{ color:"#8B8F98",fontSize:11,display:"block",marginBottom:4 }}>Password</label>
                <input type="password" value={password} onChange={function(e){setPassword(e.target.value);}}
                  placeholder="Enter your password" required
                  style={{ width:"100%",padding:"10px 14px",borderRadius:8,border:"1px solid #2A2D35",background:"#12141A",color:"#F0F1F3",fontSize:14,outline:"none",boxSizing:"border-box" }}
                  onFocus={function(e){e.target.style.borderColor="#7B2FFF";}}
                  onBlur={function(e){e.target.style.borderColor="#2A2D35";}} />
              </div>
            )}

            {error && (
              <div style={{ padding:"10px 14px",borderRadius:8,background:"#F8717112",border:"1px solid #F8717133",color:"#F87171",fontSize:12,marginBottom:12 }}>
                {error}
              </div>
            )}

            {message && (
              <div style={{ padding:"10px 14px",borderRadius:8,background:"#4ADE8012",border:"1px solid #4ADE8033",color:"#4ADE80",fontSize:12,marginBottom:12 }}>
                {message}
              </div>
            )}

            <button type="submit" disabled={loading}
              style={{ width:"100%",padding:"12px 16px",borderRadius:10,border:"none",background:loading?"#6B6F78":"linear-gradient(135deg,#7B2FFF,#00D4FF)",color:"#FFF",fontSize:14,fontWeight:700,cursor:loading?"wait":"pointer",transition:"opacity 0.2s" }}>
              {loading ? "Please wait..." : mode === "login" ? "Sign In" : mode === "signup" ? "Create Account" : "Send Reset Link"}
            </button>
          </form>

          {/* Toggle links */}
          <div style={{ marginTop:16,textAlign:"center" }}>
            {mode === "login" && (
              <div>
                <button onClick={function(){setMode("forgot");setError(null);setMessage(null);}}
                  style={{ background:"none",border:"none",color:"#7B2FFF",fontSize:12,cursor:"pointer",padding:4 }}>Forgot password?</button>
              </div>
            )}
            {mode === "forgot" && (
              <button onClick={function(){setMode("login");setError(null);setMessage(null);}}
                style={{ background:"none",border:"none",color:"#7B2FFF",fontSize:12,cursor:"pointer",padding:4 }}>Back to Sign In</button>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{ textAlign:"center",marginTop:20,color:"#6B6F78",fontSize:11 }}>
          Authorized personnel only. Access is monitored and logged.
        </div>
      </div>
    </div>
  );
}
