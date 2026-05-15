const express = require("express");
const XLSX    = require("xlsx");
const cors    = require("cors");
const https   = require("https");
require("dotenv").config();

// ── Corporate SSL proxy fix ──────────────────────────────────
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const app = express();
app.use(cors());
app.use(express.json());

// ────────────────────────────────────────────────────────────
//  All config lives in .env — never hardcode values here
//
//  MINIMUM required in .env:
//    OPENAI_API_KEY=your-key-here
//
//  If your lab uses a custom gateway, also add:
//    OPENAI_BASE_URL=https://your-lab-gateway.com/v1
//    OPENAI_MODEL=gpt-4o
//
//  If no OPENAI_BASE_URL is set, defaults to real OpenAI.
// ────────────────────────────────────────────────────────────
const OPENAI_API_KEY  = process.env.OPENAI_API_KEY;
const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
const OPENAI_MODEL    = process.env.OPENAI_MODEL || "gpt-4o-mini";

// Parse hostname and path out of the base URL
const parsedUrl    = new URL(OPENAI_BASE_URL);
const API_HOSTNAME = parsedUrl.hostname;
const API_PORT     = parsedUrl.port ? Number(parsedUrl.port) : 443;
const API_PREFIX   = parsedUrl.pathname.replace(/\/$/, "");

// Validate key at startup
if (!OPENAI_API_KEY) {
  console.warn("WARNING: OPENAI_API_KEY is missing from your .env file!");
} else {
  console.log("OpenAI API key loaded from .env");
  console.log("Endpoint : " + OPENAI_BASE_URL + "/chat/completions");
  console.log("Model    : " + OPENAI_MODEL);
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
    status:   "ok",
    sheets:   workbook.SheetNames,
    api_key:  OPENAI_API_KEY ? "set" : "NOT SET",
    endpoint: OPENAI_BASE_URL + "/chat/completions",
    model:    OPENAI_MODEL,
  });
});

// ── POST /api/chat ───────────────────────────────────────────
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

  const openAIMessages = [
    { role: "system", content: systemPrompt || "You are a helpful assistant." },
    ...messages.map(m => ({ role: m.role, content: m.content })),
  ];

  const body = JSON.stringify({
    model:      OPENAI_MODEL,
    max_tokens: 1024,
    messages:   openAIMessages,
  });

  const options = {
    hostname: API_HOSTNAME,
    port:     API_PORT,
    path:     API_PREFIX + "/chat/completions",
    method:   "POST",
    headers: {
      "Content-Type":   "application/json",
      "Authorization":  "Bearer " + OPENAI_API_KEY,
      "Content-Length": Buffer.byteLength(body),
    },
  };

  const apiReq = https.request(options, (apiRes) => {
    let data = "";
    apiRes.on("data", chunk => { data += chunk; });
    apiRes.on("end", () => {
      try {
        const parsed = JSON.parse(data);
        if (parsed.error) {
          console.error("API error:", parsed.error.message);
          return res.status(apiRes.statusCode).json({ error: parsed.error.message });
        }
        res.json({
          content: [{ text: parsed.choices?.[0]?.message?.content || "No response." }]
        });
      } catch (e) {
        res.status(500).json({ error: "Failed to parse API response", raw: data });
      }
    });
  });

  apiReq.on("error", (e) => {
    res.status(500).json({ error: "Request to API failed: " + e.message });
  });

  apiReq.write(body);
  apiReq.end();
});

app.listen(5000, () => {
  console.log("Server running on http://localhost:5000");
  console.log("Health check: http://localhost:5000/api/health");
});
