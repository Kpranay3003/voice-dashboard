const express = require("express");
const XLSX    = require("xlsx");
const cors    = require("cors");
const https   = require("https");
require("dotenv").config();   // ← reads your .env file automatically

// ── Corporate SSL proxy fix ──────────────────────────────────
// Many company networks use SSL inspection (a proxy that intercepts
// HTTPS traffic). Node.js rejects this with "unable to get local
// issuer certificate". This tells Node.js to trust the proxy's cert.
// Safe to use inside a corporate network — remove if deploying publicly.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const app = express();
app.use(cors());
app.use(express.json());

// ────────────────────────────────────────────────────────────
//  API key is loaded from your .env file — do NOT paste it here
//  In your .env file, add this line (no quotes):
//    OPENAI_API_KEY=sk-proj-xxxxxxxxxxxxxxxxxxxxxxxx
//  Get your key from: https://platform.openai.com/api-keys
// ────────────────────────────────────────────────────────────
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Validate key at startup
if (!OPENAI_API_KEY) {
  console.warn("⚠️  WARNING: OPENAI_API_KEY is missing from your .env file!");
  console.warn("   Add this line to .env:  OPENAI_API_KEY=sk-proj-your-key-here");
} else if (!OPENAI_API_KEY.startsWith("sk-")) {
  console.warn("⚠️  WARNING: OPENAI_API_KEY looks invalid (should start with sk-)");
} else {
  console.log("✅ OpenAI API key loaded from .env");
}

// ── Load Excel once at startup ───────────────────────────────
const workbook = XLSX.readFile("data.xlsx");

const getSheetData = (sheetName) => {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet);
};

// ── GET /api/node/:nodeId ────────────────────────────────────
app.get("/api/node/:nodeId", (req, res) => {
  const data = getSheetData(req.params.nodeId);
  res.json(data);
});

// ── GET /api/summary/:nodeId ─────────────────────────────────
app.get("/api/summary/:nodeId", (req, res) => {
  const data     = getSheetData(req.params.nodeId);
  const total    = data.length;
  const success  = data.filter(d => d.Status === "SUCCESS").length;
  const failed   = data.filter(d => d.Status === "FAILED").length;
  const critical = data.filter(d => d.CRITICAL === "YES").length;
  res.json({ total, success, failed, critical });
});

// ── GET /api/health ──────────────────────────────────────────
app.get("/api/health", (req, res) => {
  res.json({
    status:  "ok",
    sheets:  workbook.SheetNames,
    api_key: OPENAI_API_KEY ? "set ✅" : "NOT SET ⚠️",
  });
});

// ── POST /api/chat (proxies to OpenAI) ───────────────────────
app.post("/api/chat", (req, res) => {
  const { messages, systemPrompt } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "messages array required" });
  }

  if (!OPENAI_API_KEY) {
    return res.status(500).json({
      error: "OpenAI API key not set. Add OPENAI_API_KEY to your .env file."
    });
  }

  // OpenAI expects system message as first item in messages array
  const openAIMessages = [
    { role: "system", content: systemPrompt || "You are a helpful assistant." },
    ...messages.map(m => ({ role: m.role, content: m.content })),
  ];

  const body = JSON.stringify({
    model:      "gpt-4o-mini",  // fast + cheap; change to "gpt-4o" for smarter responses
    max_tokens: 1024,
    messages:   openAIMessages,
  });

  const options = {
    hostname: "api.openai.com",
    path:     "/v1/chat/completions",
    method:   "POST",
    headers: {
      "Content-Type":   "application/json",
      "Authorization":  `Bearer ${OPENAI_API_KEY}`,
      "Content-Length": Buffer.byteLength(body),
    },
  };

  const apiReq = https.request(options, (apiRes) => {
    let data = "";
    apiRes.on("data", chunk => { data += chunk; });
    apiRes.on("end", () => {
      try {
        const parsed = JSON.parse(data);

        // OpenAI returned an error (wrong key, quota exceeded, etc.)
        if (parsed.error) {
          console.error("OpenAI error:", parsed.error.message);
          return res.status(apiRes.statusCode).json({ error: parsed.error.message });
        }

        // Wrap response to match what FloatingAssistant.jsx expects
        res.json({
          content: [{ text: parsed.choices?.[0]?.message?.content || "No response." }]
        });

      } catch (e) {
        res.status(500).json({ error: "Failed to parse OpenAI response", raw: data });
      }
    });
  });

  apiReq.on("error", (e) => {
    res.status(500).json({ error: "Request to OpenAI failed: " + e.message });
  });

  apiReq.write(body);
  apiReq.end();
});

app.listen(5000, () => {
  console.log("✅ Server running on http://localhost:5000");
  console.log("   Health check: http://localhost:5000/api/health");
});
