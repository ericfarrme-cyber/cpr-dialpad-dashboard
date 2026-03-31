'use client';

import { Component } from "react";

// ═══ ERROR BOUNDARY ═══
// Catches React rendering crashes (like browser extension DOM conflicts)
// and shows a recovery UI instead of white-screening

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null, retryCount: 0 };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error: error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo: errorInfo });

    // Auto-retry once for transient DOM errors (browser extension conflicts)
    var isExtensionError =
      (error.message && (
        error.message.includes("removeChild") ||
        error.message.includes("insertBefore") ||
        error.message.includes("appendChild") ||
        error.message.includes("not a child") ||
        error.message.includes("Node")
      ));

    if (isExtensionError && this.state.retryCount < 2) {
      // Brief delay then auto-recover
      var self = this;
      setTimeout(function() {
        self.setState(function(prev) {
          return { hasError: false, error: null, errorInfo: null, retryCount: prev.retryCount + 1 };
        });
      }, 500);
    }

    // Log to console for debugging
    console.error("[ErrorBoundary] Caught error:", error.message);
    if (errorInfo && errorInfo.componentStack) {
      console.error("[ErrorBoundary] Component stack:", errorInfo.componentStack);
    }
  }

  render() {
    if (this.state.hasError) {
      var isExtensionError = this.state.error && this.state.error.message && (
        this.state.error.message.includes("removeChild") ||
        this.state.error.message.includes("insertBefore") ||
        this.state.error.message.includes("not a child")
      );

      var self = this;

      return (
        <div style={{ background: "#0F1117", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Space Grotesk', -apple-system, sans-serif" }}>
          <div style={{ background: "#1A1D23", borderRadius: 16, padding: 40, maxWidth: 520, width: "90%", textAlign: "center", border: "1px solid #2A2D35" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>{isExtensionError ? "\uD83D\uDD0C" : "\u26A0\uFE0F"}</div>
            <h2 style={{ color: "#F0F1F3", fontSize: 20, fontWeight: 800, margin: "0 0 8px" }}>
              {isExtensionError ? "Browser Extension Conflict" : "Something Went Wrong"}
            </h2>
            <p style={{ color: "#8B8F98", fontSize: 13, lineHeight: 1.6, margin: "0 0 20px" }}>
              {isExtensionError
                ? "A browser extension is interfering with the dashboard. Try disabling extensions like Grammarly, ad blockers, or translation tools — or open this page in an incognito window."
                : "An unexpected error occurred. This is usually temporary."
              }
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
              <button
                onClick={function() {
                  self.setState({ hasError: false, error: null, errorInfo: null, retryCount: 0 });
                }}
                style={{ padding: "10px 24px", borderRadius: 8, border: "none", background: "linear-gradient(135deg, #7B2FFF, #00D4FF)", color: "#FFF", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                Try Again
              </button>
              <button
                onClick={function() { window.location.reload(); }}
                style={{ padding: "10px 24px", borderRadius: 8, border: "1px solid #2A2D35", background: "transparent", color: "#8B8F98", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                Reload Page
              </button>
            </div>
            {this.state.retryCount > 0 && (
              <p style={{ color: "#6B6F78", fontSize: 11, marginTop: 16 }}>
                Auto-recovered {this.state.retryCount} time{this.state.retryCount > 1 ? "s" : ""}. If this keeps happening, try incognito mode (Ctrl+Shift+N).
              </p>
            )}
            {!isExtensionError && this.state.error && (
              <div style={{ marginTop: 16, padding: 12, background: "#12141A", borderRadius: 8, textAlign: "left" }}>
                <div style={{ color: "#F87171", fontSize: 11, fontFamily: "monospace", wordBreak: "break-all" }}>
                  {this.state.error.message}
                </div>
              </div>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
