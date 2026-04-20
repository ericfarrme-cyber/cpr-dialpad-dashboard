'use client';

import { createContext, useContext, useState, useEffect } from "react";

var ThemeContext = createContext({ theme: "dark", toggleTheme: function() {} });

export function useTheme() { return useContext(ThemeContext); }

var DARK = {
  "--bg-page": "#0F1117",
  "--bg-card": "#1A1D23",
  "--bg-card-inner": "#12141A",
  "--bg-input": "#12141A",
  "--bg-hover": "#1E2028",
  "--border": "#2A2D35",
  "--border-light": "#1E2028",
  "--border-heavy": "#3A3D45",
  "--text-primary": "#F0F1F3",
  "--text-body": "#C8CAD0",
  "--text-secondary": "#8B8F98",
  "--text-muted": "#6B6F78",
  "--text-faint": "#6B7280",
  "--text-dim": "#9CA3AF",
  // Brand colors — same in both themes
  "--cyan": "#00D4FF",
  "--purple": "#7B2FFF",
  "--pink": "#FF2D95",
  "--green": "#4ADE80",
  "--yellow": "#FBBF24",
  "--red": "#F87171",
  "--orange": "#FB923C",
  // Semantic
  "--shadow": "0 2px 8px rgba(0,0,0,0.3)",
  "--overlay": "rgba(0,0,0,0.5)",
};

var LIGHT = {
  "--bg-page": "#F3F4F6",
  "--bg-card": "#FFFFFF",
  "--bg-card-inner": "#F9FAFB",
  "--bg-input": "#F3F4F6",
  "--bg-hover": "#F0F1F3",
  "--border": "#D1D5DB",
  "--border-light": "#E5E7EB",
  "--border-heavy": "#9CA3AF",
  "--text-primary": "#111827",
  "--text-body": "#374151",
  "--text-secondary": "#4B5563",
  "--text-muted": "#6B7280",
  "--text-faint": "#9CA3AF",
  "--text-dim": "#6B7280",
  // Brand colors — slightly deeper for light bg contrast
  "--cyan": "#0099CC",
  "--purple": "#6D28D9",
  "--pink": "#DB2777",
  "--green": "#16A34A",
  "--yellow": "#D97706",
  "--red": "#DC2626",
  "--orange": "#EA580C",
  // Semantic
  "--shadow": "0 2px 8px rgba(0,0,0,0.08)",
  "--overlay": "rgba(0,0,0,0.2)",
};

export function ThemeToggle({ style }) {
  var { theme, toggleTheme } = useTheme();
  return (
    <button onClick={toggleTheme} title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      style={Object.assign({
        padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)",
        background: "var(--bg-card-inner)", color: "var(--text-secondary)",
        fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", gap: 4,
        transition: "all 0.2s",
      }, style || {})}>
      {theme === "dark" ? "\u2600\uFE0F" : "\uD83C\uDF19"}
    </button>
  );
}

export default function ThemeProvider({ children }) {
  var [theme, setTheme] = useState("dark");

  useEffect(function() {
    try {
      var saved = localStorage.getItem("cpr-theme");
      if (saved === "light" || saved === "dark") setTheme(saved);
    } catch(e) {}
  }, []);

  useEffect(function() {
    var vars = theme === "light" ? LIGHT : DARK;
    var root = document.documentElement;
    Object.entries(vars).forEach(function(entry) {
      root.style.setProperty(entry[0], entry[1]);
    });
    root.style.setProperty("color-scheme", theme);
    try { localStorage.setItem("cpr-theme", theme); } catch(e) {}
  }, [theme]);

  var toggleTheme = function() { setTheme(function(t) { return t === "dark" ? "light" : "dark"; }); };

  return (
    <ThemeContext.Provider value={{ theme: theme, toggleTheme: toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
