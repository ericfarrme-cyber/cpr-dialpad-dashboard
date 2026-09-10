"use client";
import { useState, useEffect } from "react";
import { useTheme } from "@/components/ThemeProvider";

// Recharts writes colours into SVG presentation attributes (fill="…",
// stroke="…"), and browsers do NOT resolve var() there — the mark renders
// black. CSS `style` props resolve fine, so this only matters for charts.
//
// This reads the tokens' computed values off the document and re-reads them
// whenever the theme flips, so a chart can stay theme-aware while still handing
// Recharts a literal colour.
//
// Fallbacks are the dark values, so a chart is still readable on the first paint
// before the provider's effect has run.
var FALLBACK = {
  "--green": "#4ADE80",
  "--yellow": "#FBBF24",
  "--orange": "#FB923C",
  "--red": "#F87171",
  "--cyan": "#00D4FF",
  "--purple": "#7B2FFF",
  "--pink": "#FF2D95",
  "--border": "#2A2D35",
  "--border-light": "#1E2028",
  "--bg-card": "#1A1D23",
  "--bg-card-inner": "#12141A",
  "--text-primary": "#F0F1F3",
  "--text-body": "#C8CAD0",
  "--text-secondary": "#8B8F98",
  "--text-muted": "#6B6F78",
};

export function useThemeColors() {
  var theme = useTheme().theme;
  var [colors, setColors] = useState(FALLBACK);

  useEffect(function() {
    try {
      var cs = getComputedStyle(document.documentElement);
      var out = {};
      Object.keys(FALLBACK).forEach(function(k) {
        var v = (cs.getPropertyValue(k) || "").trim();
        out[k] = v || FALLBACK[k];
      });
      setColors(out);
    } catch (e) {
      setColors(FALLBACK);
    }
  }, [theme]);

  return colors;
}
