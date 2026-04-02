// Vercel Serverless Function — /api/ai.js
// Proxies requests to Anthropic API without exposing the key client-side.
// Env var: ANTHROPIC_API_KEY
// Passes through all body params (messages, tools, system, etc.)

export const config = {
  api: { bodyParser: { sizeLimit: "10mb" } },
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const KEY = process.env.ANTHROPIC_API_KEY;
  if (!KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });

  try {
    // Pass through all body params, just ensure model and max_tokens have defaults
    const body = { ...req.body };
    if (!body.model) body.model = "claude-sonnet-4-20250514";
    if (!body.max_tokens) body.max_tokens = 2000;

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);

    // Extract text from response, also pass raw content for advanced consumers
    const text = data.content?.map(b => b.text || "").join("") || "";
    return res.status(200).json({ text, content: data.content, model: data.model, usage: data.usage });
  } catch (err) {
    return res.status(500).json({ error: "AI request failed: " + err.message });
  }
}
