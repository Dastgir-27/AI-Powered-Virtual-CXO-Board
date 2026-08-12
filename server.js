require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const { parse } = require("csv-parse/sync");
const { GoogleGenAI } = require("@google/genai");
const { v4: uuidv4 } = require("uuid");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const GEMINI_MODEL = "gemini-flash-latest";

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const SESSIONS_DIR = path.join(__dirname, "sessions");
const UPLOADS_DIR = path.join(__dirname, "uploads");
[SESSIONS_DIR, UPLOADS_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => cb(null, `${req.params.id}_data${path.extname(file.originalname)}`),
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

const PERSONAS = {
  CFO: {
    name: "Alex Chen", title: "Chief Financial Officer", initials: "CFO", color: "#059669",
    systemPrompt: `You are Alex Chen, CFO. 20 years in corporate finance. Your priorities: protect margins, EBITDA, cash flow. Skeptical of vague growth promises. Always cite specific numbers. Push back on CMO spend without ROI. Align with COO on operational efficiency. Be direct, numbers-first, brief (3-5 sentences).`,
  },
  CMO: {
    name: "Priya Sharma", title: "Chief Marketing Officer", initials: "CMO", color: "#e11d48",
    systemPrompt: `You are Priya Sharma, CMO. 18 years in brand strategy and demand generation. Your priorities: brand equity, market share, growth. Believe cutting marketing during downturns is shortsighted. Push back hard on CFO blanket cuts. Align with CSO on positioning. Be energetic, customer-centric, strategic (3-5 sentences).`,
  },
  COO: {
    name: "Marcus Williams", title: "Chief Operating Officer", initials: "COO", color: "#d97706",
    systemPrompt: `You are Marcus Williams, COO. 22 years in operations and supply chain. Your priorities: execution, efficiency, reducing operational friction. Most financial problems are operational problems. Be the pragmatist, offer concrete next steps. Mediate between CFO and CMO. Calm, methodical, action-oriented (3-5 sentences).`,
  },
  CSO: {
    name: "Jordan Park", title: "Chief Strategy Officer", initials: "CSO", color: "#7c3aed",
    systemPrompt: `You are Jordan Park, CSO. Ex-McKinsey, 15 years in strategy and M&A. Your priorities: long-term competitive positioning over short-term optimization. Think in 3-5 year arcs. Bring external context: competitor moves, industry trends. Challenge group when they optimize locally and miss strategic risk. Thoughtful, frameworks-driven, provocative (3-5 sentences).`,
  },
};
const PERSONA_ORDER = ["CFO", "CMO", "COO", "CSO"];

function getSessionPath(id) { return path.join(SESSIONS_DIR, `${id}.json`); }
function loadSession(id) {
  const p = getSessionPath(id);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}
function saveSession(session) { fs.writeFileSync(getSessionPath(session.id), JSON.stringify(session, null, 2)); }
function listSessions() {
  return fs.readdirSync(SESSIONS_DIR).filter((f) => f.endsWith(".json")).map((f) => {
    const s = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, f), "utf-8"));
    return { id: s.id, title: s.title, createdAt: s.createdAt, messageCount: s.messages.length };
  }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}
function formatDataForPrompt(session) {
  if (!session.uploadedData || session.uploadedData.length === 0) return "";
  const rows = session.uploadedData;
  const headers = Object.keys(rows[0]).join(" | ");
  const divider = Object.keys(rows[0]).map(() => "---").join(" | ");
  const tableRows = rows.map((r) => "| " + Object.values(r).join(" | ") + " |").join("\n");
  return `\n\nCOMPANY DATA (P&L):\n| ${headers} |\n| ${divider} |\n${tableRows}\n\nReference specific numbers from this data where relevant.\n`;
}

async function generateBoardRound(ceoQuestion, priorResponses, session, round) {
  const dataContext = formatDataForPrompt(session);
  const recentHistory = session.messages.slice(-10).map((m) => `[${m.speaker}]: ${m.content}`).join("\n");
  const personasIntro = PERSONA_ORDER.map((key) => {
    const p = PERSONAS[key];
    return `### ${p.initials}: ${p.name} (${p.title})\n${p.systemPrompt}`;
  }).join("\n\n");

  let prompt = "";
  if (round === 1) {
    prompt = `You are simulating a boardroom meeting. Generate the initial response for each of the 4 executives.\n\nPERSONAS:\n${personasIntro}\n${dataContext}\nRECENT CONTEXT:\n${recentHistory || "Start of session."}\n\nCEO QUESTION: "${ceoQuestion}"\n\nReturn ONLY valid JSON array, no markdown:\n[\n  { "speaker": "CFO", "content": "..." },\n  { "speaker": "CMO", "content": "..." },\n  { "speaker": "COO", "content": "..." },\n  { "speaker": "CSO", "content": "..." }\n]`;
  } else {
    const r1 = priorResponses.map((r) => `[${PERSONAS[r.persona].name} (${r.persona})]: ${r.content}`).join("\n\n");
    prompt = `You are simulating the DEBATE round of a boardroom meeting. Generate debate/pushback responses for each executive.\n\nPERSONAS:\n${personasIntro}\n${dataContext}\nRECENT CONTEXT:\n${recentHistory || "Start of session."}\n\nCEO QUESTION: "${ceoQuestion}"\n\nROUND 1 PERSPECTIVES:\n${r1}\n\nEach executive should react to specific colleagues by name, push back or agree with nuance, 3-5 sentences.\n\nReturn ONLY valid JSON array, no markdown:\n[\n  { "speaker": "CFO", "content": "..." },\n  { "speaker": "CMO", "content": "..." },\n  { "speaker": "COO", "content": "..." },\n  { "speaker": "CSO", "content": "..." }\n]`;
  }

  const result = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: prompt,
    config: { responseMimeType: "application/json" },
  });

  const text = result.text.trim();
  try {
    const arr = JSON.parse(text);
    if (Array.isArray(arr) && arr.length > 0) return arr;
    throw new Error("Not a valid array");
  } catch (e) {
    console.error("JSON parse failed:", text);
    throw new Error("Model returned invalid JSON");
  }
}

async function generateBoardRoundWithRetry(ceoQuestion, priorResponses, session, round, retries = 4, delayMs = 8000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await generateBoardRound(ceoQuestion, priorResponses, session, round);
    } catch (e) {
      const isTransient = e.status === 429 || e.status === 503 ||
        (e.message && (e.message.includes("429") || e.message.includes("503") || e.message.includes("Quota") ||
          e.message.includes("limit") || e.message.includes("demand") || e.message.includes("UNAVAILABLE") || e.message.includes("overloaded")));
      if (isTransient && i < retries - 1) {
        console.warn(`[Retry] Round ${round}, attempt ${i + 1}, waiting ${delayMs / 1000}s...`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        delayMs *= 2;
      } else {
        throw e;
      }
    }
  }
}

app.get("/api/models", async (req, res) => {
  try {
    const pager = await ai.models.list();
    const models = [];
    for await (const m of pager) models.push(m.name);
    res.json(models);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/sessions", (req, res) => {
  try { res.json(listSessions()); } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/session/new", (req, res) => {
  const session = { id: uuidv4(), title: req.body.title || "New Board Session", createdAt: new Date().toISOString(), messages: [], uploadedData: [], uploadedFileName: null };
  saveSession(session);
  res.json(session);
});

app.get("/api/session/:id", (req, res) => {
  const session = loadSession(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });
  res.json(session);
});

app.delete("/api/session/:id", (req, res) => {
  const p = getSessionPath(req.params.id);
  if (!fs.existsSync(p)) return res.status(404).json({ error: "Session not found" });
  fs.unlinkSync(p);
  res.json({ success: true });
});

app.post("/api/session/:id/upload", upload.single("file"), (req, res) => {
  const session = loadSession(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  try {
    const content = fs.readFileSync(req.file.path, "utf-8");
    let data;
    if (req.file.originalname.endsWith(".json")) {
      data = JSON.parse(content);
      if (!Array.isArray(data)) data = [data];
    } else {
      data = parse(content, { columns: true, skip_empty_lines: true, trim: true });
    }
    session.uploadedData = data;
    session.uploadedFileName = req.file.originalname;
    session.messages.push({ id: uuidv4(), speaker: "SYSTEM", content: `P&L data loaded: ${req.file.originalname} (${data.length} rows).`, timestamp: new Date().toISOString(), round: null });
    saveSession(session);
    res.json({ success: true, rows: data.length, fileName: req.file.originalname });
  } catch (e) { res.status(400).json({ error: `Failed to parse file: ${e.message}` }); }
});

app.post("/api/session/:id/message", async (req, res) => {
  const session = loadSession(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });
  const { content } = req.body;
  if (!content || !content.trim()) return res.status(400).json({ error: "Message content required" });

  if (session.messages.filter((m) => m.speaker === "CEO").length === 0) {
    session.title = content.length > 60 ? content.slice(0, 57) + "..." : content;
  }

  const ceoMsg = { id: uuidv4(), speaker: "CEO", content: content.trim(), timestamp: new Date().toISOString(), round: null };
  session.messages.push(ceoMsg);
  saveSession(session);

  try {
    const allNewMessages = [ceoMsg];

    console.log("[Round 1] Generating initial perspectives...");
    const r1Results = await generateBoardRoundWithRetry(content, [], session, 1);
    const roundOneResponses = [];
    r1Results.forEach((res) => {
      const key = (res.speaker || "").toUpperCase();
      if (!PERSONAS[key]) return;
      const msg = { id: uuidv4(), speaker: key, personaName: PERSONAS[key].name, personaTitle: PERSONAS[key].title, content: res.content, timestamp: new Date().toISOString(), round: 1 };
      session.messages.push(msg);
      allNewMessages.push(msg);
      roundOneResponses.push({ persona: key, content: res.content });
    });
    saveSession(session);

    console.log("[Round 2] Generating debate responses...");
    const r2Results = await generateBoardRoundWithRetry(content, roundOneResponses, session, 2);
    r2Results.forEach((res) => {
      const key = (res.speaker || "").toUpperCase();
      if (!PERSONAS[key]) return;
      const msg = { id: uuidv4(), speaker: key, personaName: PERSONAS[key].name, personaTitle: PERSONAS[key].title, content: res.content, timestamp: new Date().toISOString(), round: 2 };
      session.messages.push(msg);
      allNewMessages.push(msg);
    });
    saveSession(session);

    res.json({ messages: allNewMessages });
  } catch (e) {
    console.error("Board error:", e);
    res.status(500).json({ error: `AI error: ${e.message}` });
  }
});

app.listen(PORT, () => {
  console.log(`\nVirtual CXO Board running at http://localhost:${PORT}`);
  console.log(`Sessions: ${SESSIONS_DIR}`);
  console.log(`Gemini API: ${process.env.GEMINI_API_KEY ? "Loaded" : "MISSING"}\n`);
});