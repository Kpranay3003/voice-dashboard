const express = require("express");
const XLSX    = require("xlsx");
const cors    = require("cors");
const https   = require("https");

const app = express();
app.use(cors());
app.use(express.json());

// ────────────────────────────────────────────────────────────
//  PUT YOUR OPENAI API KEY HERE
//  Get it from: https://platform.openai.com/api-keys
//  It looks like: sk-proj-xxxxxxxxxxxxxxxxxxxxxxxx
// ────────────────────────────────────────────────────────────
const OPENAI_API_KEY = "API_KEY";
// ────────────────────────────────────────────────────────────

// Warn if key not set
if (!OPENAI_API_KEY || OPENAI_API_KEY.includes("paste-your")) {
  console.warn("⚠️  WARNING: OpenAI API key not set in server.cjs!");
  console.warn("   Edit server.cjs and replace the placeholder key.");
} else {
  console.log("✅ OpenAI API key loaded.");
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
    api_key: OPENAI_API_KEY.includes("paste-your") ? "NOT SET ⚠️" : "set ✅",
  });
});

// ── POST /api/chat (proxies to OpenAI) ───────────────────────
app.post("/api/chat", (req, res) => {
  const { messages, systemPrompt } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "messages array required" });
  }

  if (!OPENAI_API_KEY || OPENAI_API_KEY.includes("paste-your")) {
    return res.status(500).json({
      error: "OpenAI API key not set. Edit server.cjs and add your key."
    });
  }

  // OpenAI expects system message as first item in messages array
  const openAIMessages = [
    { role: "system", content: systemPrompt || "You are a helpful assistant." },
    ...messages.map(m => ({ role: m.role, content: m.content })),
  ];

  const body = JSON.stringify({
    model:       "gpt-4o-mini",   // fast + cheap, change to "gpt-4o" for smarter
    max_tokens:  1024,
    messages:    openAIMessages,
  });

  const options = {
    hostname: "api.openai.com",
    path:     "/v1/chat/completions",
    method:   "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${OPENAI_API_KEY}`,  // ← OpenAI uses Bearer token
      "Content-Length": Buffer.byteLength(body),
    },
  };

  const apiReq = https.request(options, (apiRes) => {
    let data = "";
    apiRes.on("data", chunk => { data += chunk; });
    apiRes.on("end", () => {
      try {
        const parsed = JSON.parse(data);

        // OpenAI error (wrong key, quota, etc.)
        if (parsed.error) {
          return res.status(apiRes.statusCode).json({ error: parsed.error.message });
        }

        // Convert OpenAI response format → send to frontend
        // OpenAI: parsed.choices[0].message.content
        // We wrap it to match what FloatingAssistant.jsx expects
        res.json({
          content: [{ text: parsed.choices?.[0]?.message?.content || "No response." }]
        });

      } catch {
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
