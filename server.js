require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const { parse } = require("csv-parse/sync");
const { GoogleGenAI } = require("@google/genai");
const { v4: uuidv4 } = require("uuid");
const fs = require("fs");
const path = require("path");

// ─── Setup ────────────────────────────────────────────────────────────────────
const app = express();
const PORT = process.env.PORT || 3000;
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const GEMINI_MODEL = "gemini-flash-latest";

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Ensure directories exist
const SESSIONS_DIR = path.join(__dirname, "sessions");
const UPLOADS_DIR = path.join(__dirname, "uploads");
[SESSIONS_DIR, UPLOADS_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ─── File Upload ──────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => cb(null, `${req.params.id}_data${path.extname(file.originalname)}`),
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

// ─── Persona Definitions ──────────────────────────────────────────────────────
const PERSONAS = {
  CFO: {
    name: "Alex Chen",
    title: "Chief Financial Officer",
    initials: "CFO",
    color: "#059669",
    systemPrompt: `You are Alex Chen, the Chief Financial Officer of this company. 
You have 20 years of experience in corporate finance, M&A, and capital markets.

Your priorities and lens:
- Financial discipline above all: protect margins, EBITDA, and cash flow
- You are deeply skeptical of growth investment that doesn't show clear ROI within 18 months
- You believe in data-driven decisions and always reference specific numbers from available P&L data
- You tend to clash with the CMO on marketing spend and brand investment
- You support the COO on operational efficiency initiatives
- Your communication style: direct, numbers-first, occasionally blunt

When responding:
1. Always lead with the financial implication
2. Reference specific figures from the data if available
3. Be skeptical of vague growth promises — demand metrics
4. Push back on the CMO if they advocate for spend without clear attribution
5. Keep responses to 3-5 sentences — executive-level brevity`,
  },
  CMO: {
    name: "Priya Sharma",
    title: "Chief Marketing Officer",
    initials: "CMO",
    color: "#e11d48",
    systemPrompt: `You are Priya Sharma, the Chief Marketing Officer of this company.
You have 18 years of experience in brand strategy, demand generation, and digital marketing.

Your priorities and lens:
- Brand equity and market share are long-term assets — cutting them is short-sighted
- You believe growth investment during downturns creates disproportionate market share gains
- You clash with the CFO when they push blanket cost-cutting that would damage the brand
- You align with the CSO on market positioning and competitive strategy
- Your communication style: energetic, customer-centric, strategic, occasionally pushes back hard on finance

When responding:
1. Always bring the customer and market perspective
2. Reference competitive dynamics, brand health, and growth opportunity costs
3. Defend growth investment with strategic rationale, not just gut feel
4. Push back on the CFO if their cuts would damage customer acquisition or retention
5. Keep responses to 3-5 sentences — executive-level brevity`,
  },
  COO: {
    name: "Marcus Williams",
    title: "Chief Operating Officer",
    initials: "COO",
    color: "#d97706",
    systemPrompt: `You are Marcus Williams, the Chief Operating Officer of this company.
You have 22 years of experience in supply chain, operations management, and organizational design.

Your priorities and lens:
- Execution and operational efficiency are your north star
- You believe most financial problems are operational problems in disguise
- You are pragmatic and solutions-oriented — you find the "how" while others debate the "what"
- You align with the CFO on cost discipline but push back if cuts would hurt execution capacity
- You often mediate between CFO and CMO by finding operational solutions
- Your communication style: calm, methodical, action-oriented, practical

When responding:
1. Always bring the operational / execution angle — what needs to change in how we work?
2. Identify specific operational levers (headcount, process, vendor contracts, automation)
3. Be the voice of pragmatism when debate gets too abstract
4. Offer concrete next steps or milestones
5. Keep responses to 3-5 sentences — executive-level brevity`,
  },
  CSO: {
    name: "Jordan Park",
    title: "Chief Strategy Officer",
    initials: "CSO",
    color: "#7c3aed",
    systemPrompt: `You are Jordan Park, the Chief Strategy Officer of this company.
You have 15 years of experience in strategy consulting (ex-McKinsey), M&A, and corporate development.

Your priorities and lens:
- Long-term competitive positioning over short-term optimization
- You think in 3-5 year arcs and worry that short-term cuts create strategic vulnerability
- You align with the CMO on protecting market position but demand strategic discipline, not just spend
- You challenge the CFO when short-term cuts could damage long-term competitive moat
- You bring external market context: competitor moves, industry trends, disruption risks
- Your communication style: thoughtful, frameworks-driven, big-picture, sometimes provocative

When responding:
1. Always zoom out — what does this mean for our 3-year competitive position?
2. Reference competitor behavior, industry trends, or strategic frameworks where relevant
3. Challenge the group if they're optimizing locally while missing the bigger strategic risk
4. Connect tactical decisions to long-term strategic bets
5. Keep responses to 3-5 sentences — executive-level brevity`,
  },
};

const PERSONA_ORDER = ["CFO", "CMO", "COO", "CSO"];

// ─── Session Helpers ──────────────────────────────────────────────────────────
function getSessionPath(id) {
  return path.join(SESSIONS_DIR, `${id}.json`);
}

function loadSession(id) {
  const p = getSessionPath(id);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

function saveSession(session) {
  fs.writeFileSync(getSessionPath(session.id), JSON.stringify(session, null, 2));
}

function listSessions() {
  return fs
    .readdirSync(SESSIONS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const s = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, f), "utf-8"));
      return { id: s.id, title: s.title, createdAt: s.createdAt, messageCount: s.messages.length };
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

// ─── Data Formatting ──────────────────────────────────────────────────────────
function formatDataForPrompt(session) {
  if (!session.uploadedData || session.uploadedData.length === 0) return "";
  const rows = session.uploadedData;
  const headers = Object.keys(rows[0]).join(" | ");
  const divider = Object.keys(rows[0]).map(() => "---").join(" | ");
  const body = rows.map((r) => Object.values(r).join(" | ")).join("\n");
  return `\n\n📊 COMPANY DATA (P&L / KPIs):\n| ${headers} |\n| ${divider} |\n${rows
    .map((r) => "| " + Object.values(r).join(" | ") + " |")
    .join("\n")}\n\nYou MUST reference specific numbers from this data in your response where relevant.\n`;
}

// ─── Gemini Call ──────────────────────────────────────────────────────────────
async function callPersona(personaKey, ceoQuestion, priorResponses, session, round) {
  const persona = PERSONAS[personaKey];
  const dataContext = formatDataForPrompt(session);

  // Build conversation history for context
  const recentHistory = session.messages
    .slice(-10)
    .map((m) => `[${m.speaker}]: ${m.content}`)
    .join("\n");

  let prompt = "";

  if (round === 1) {
    prompt = `${persona.systemPrompt}
${dataContext}

BOARD SESSION CONTEXT (recent history):
${recentHistory || "This is the start of the session."}

The CEO has just asked:
"${ceoQuestion}"

Give your initial response as ${persona.name}, ${persona.title}. Be direct, stay in character, and reference the data if available.`;
  } else {
    // Round 2: debate/pushback
    const roundOneResponses = priorResponses
      .map((r) => `[${PERSONAS[r.persona].name} — ${r.persona}]: ${r.content}`)
      .join("\n\n");

    prompt = `${persona.systemPrompt}
${dataContext}

BOARD SESSION CONTEXT (recent history):
${recentHistory || "This is the start of the session."}

The CEO asked: "${ceoQuestion}"

Your colleagues have already weighed in:
${roundOneResponses}

Now respond as ${persona.name}, ${persona.title}. This is the DEBATE round — you should:
- Agree with what makes sense, but push back on what you disagree with
- Call out a specific colleague by name if you're challenging them
- Add any nuance or angle that was missed in Round 1
- Keep it brief and executive — 3-5 sentences`;
  }

  const result = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: prompt,
  });
  return result.text.trim();
}

// ─── API Routes ───────────────────────────────────────────────────────────────

// List available Gemini models for this API key
app.get("/api/models", async (req, res) => {
  try {
    const pager = await ai.models.list();
    const models = [];
    for await (const m of pager) models.push(m.name);
    res.json(models);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// List all sessions

app.get("/api/sessions", (req, res) => {
  try {
    res.json(listSessions());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Create new session
app.post("/api/session/new", (req, res) => {
  const session = {
    id: uuidv4(),
    title: req.body.title || "New Board Session",
    createdAt: new Date().toISOString(),
    messages: [],
    uploadedData: [],
    uploadedFileName: null,
  };
  saveSession(session);
  res.json(session);
});

// Get session
app.get("/api/session/:id", (req, res) => {
  const session = loadSession(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });
  res.json(session);
});

// Delete session
app.delete("/api/session/:id", (req, res) => {
  const p = getSessionPath(req.params.id);
  if (!fs.existsSync(p)) return res.status(404).json({ error: "Session not found" });
  fs.unlinkSync(p);
  res.json({ success: true });
});

// Upload P&L data
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
      // CSV
      data = parse(content, { columns: true, skip_empty_lines: true, trim: true });
    }

    session.uploadedData = data;
    session.uploadedFileName = req.file.originalname;

    // Add a system message to the chat
    session.messages.push({
      id: uuidv4(),
      speaker: "SYSTEM",
      content: `📊 P&L data loaded: **${req.file.originalname}** (${data.length} rows). The board will now reference this data in their responses.`,
      timestamp: new Date().toISOString(),
      round: null,
    });

    saveSession(session);
    res.json({ success: true, rows: data.length, fileName: req.file.originalname });
  } catch (e) {
    res.status(400).json({ error: `Failed to parse file: ${e.message}` });
  }
});

// CEO sends a message → triggers board discussion
app.post("/api/session/:id/message", async (req, res) => {
  const session = loadSession(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });

  const { content } = req.body;
  if (!content || !content.trim()) return res.status(400).json({ error: "Message content required" });

  // Auto-title session from first message
  if (session.messages.filter((m) => m.speaker === "CEO").length === 0) {
    session.title = content.length > 60 ? content.slice(0, 57) + "..." : content;
  }

  // Add CEO message
  const ceoMsg = {
    id: uuidv4(),
    speaker: "CEO",
    content: content.trim(),
    timestamp: new Date().toISOString(),
    round: null,
  };
  session.messages.push(ceoMsg);
  saveSession(session);

  try {
    const allNewMessages = [ceoMsg];

    // Helper wrapper to handle retries for API calls on 429
    async function callPersonaWithRetry(personaKey, ceoQuestion, priorResponses, round, retries = 3, delayMs = 12000) {
      for (let i = 0; i < retries; i++) {
        try {
          return await callPersona(personaKey, ceoQuestion, priorResponses, session, round);
        } catch (e) {
          const isRateLimit = e.status === 429 || 
                              (e.message && (e.message.includes("429") || e.message.includes("Quota") || e.message.includes("limit")));
          if (isRateLimit && i < retries - 1) {
            console.warn(`[429 Quota] Retrying ${personaKey} (Round ${round}) in ${delayMs / 1000}s (Attempt ${i + 1}/${retries})...`);
            await new Promise((resolve) => setTimeout(resolve, delayMs));
            delayMs *= 1.5; // Exponential backoff
          } else {
            throw e;
          }
        }
      }
    }

    // ── Round 1: Initial responses (Parallel) ────────────────────────────────
    console.log("Triggering Round 1 responses in parallel...");
    const roundOnePromises = PERSONA_ORDER.map(async (personaKey) => {
      const responseText = await callPersonaWithRetry(personaKey, content, [], 1);
      return { persona: personaKey, content: responseText };
    });

    const roundOneResponses = await Promise.all(roundOnePromises);

    // Save and prepare messages for Round 1
    roundOneResponses.forEach((res) => {
      const msg = {
        id: uuidv4(),
        speaker: res.persona,
        personaName: PERSONAS[res.persona].name,
        personaTitle: PERSONAS[res.persona].title,
        content: res.content,
        timestamp: new Date().toISOString(),
        round: 1,
      };
      session.messages.push(msg);
      allNewMessages.push(msg);
    });
    saveSession(session);

    // ── Round 2: Debate/pushback (Parallel) ──────────────────────────────────
    console.log("Triggering Round 2 debate in parallel...");
    const roundTwoPromises = PERSONA_ORDER.map(async (personaKey) => {
      const responseText = await callPersonaWithRetry(personaKey, content, roundOneResponses, 2);
      return { persona: personaKey, content: responseText };
    });

    const roundTwoResponses = await Promise.all(roundTwoPromises);

    // Save and prepare messages for Round 2
    roundTwoResponses.forEach((res) => {
      const msg = {
        id: uuidv4(),
        speaker: res.persona,
        personaName: PERSONAS[res.persona].name,
        personaTitle: PERSONAS[res.persona].title,
        content: res.content,
        timestamp: new Date().toISOString(),
        round: 2,
      };
      session.messages.push(msg);
      allNewMessages.push(msg);
    });
    saveSession(session);

    res.json({ messages: allNewMessages });
  } catch (e) {
    console.error("Gemini error:", e);
    res.status(500).json({ error: `AI error: ${e.message}` });
  }
});

// ─── Start Server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🏛️  Virtual CXO Board running at http://localhost:${PORT}`);
  console.log(`   Sessions stored in: ${SESSIONS_DIR}`);
  console.log(`   Gemini API key: ${process.env.GEMINI_API_KEY ? "✅ Loaded" : "❌ MISSING — set GEMINI_API_KEY in .env"}\n`);
});
