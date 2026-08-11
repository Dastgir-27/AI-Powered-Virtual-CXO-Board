# 🏛️ Virtual CXO Board — AI Executive Boardroom

A working prototype of an AI-powered virtual board of C-suite executives. The CEO can pose business questions, and a panel of distinct executive personas (CFO, CMO, COO, CSO) each respond with their own lens — then debate each other.

---

## ⚡ Quick Start

### 1. Prerequisites
- **Node.js** v18+ ([download](https://nodejs.org))
- A **Google Gemini API key** ([get one free](https://aistudio.google.com/app/apikey))

### 2. Install dependencies
```bash
npm install
```

### 3. Add your API key
Open the `.env` file and replace the placeholder:
```
GEMINI_API_KEY=your_actual_key_here
```

### 4. Run the app
```bash
npm start
```

Open your browser at **http://localhost:3000**

---

## 🎮 How to Use

1. **Click "New Session"** to start a board meeting
2. *(Optional)* Upload the included `sample_pl_data.csv` via the sidebar — the board will reference actual numbers
3. **Type your question** in the CEO input bar and press Enter (or click Send)
4. Watch the board respond in **two rounds**:
   - **Round 1** — Each executive gives their initial perspective
   - **Round 2** — They debate, push back, and challenge each other
5. **Return later** — sessions persist as JSON files in the `sessions/` folder

### Example Questions to Try
- *"Our Q3 margins dropped 4 points. What should we do?"*
- *"Should we expand into Southeast Asia next year?"*
- *"A competitor just cut prices by 15%. How do we respond?"*
- *"We need to cut $2M from the budget. Where do we start?"*

---

## 🗂️ Project Structure

```
virtual-cxo-board/
├── server.js           # Express backend — Gemini API, session management, file upload
├── .env                # Your Gemini API key (never commit this)
├── package.json
├── sample_pl_data.csv  # Demo P&L data to upload
├── sessions/           # Persistent session JSON files (auto-created)
├── uploads/            # Uploaded data files (auto-created)
└── public/
    ├── index.html      # Boardroom UI
    ├── style.css       # Premium light-mode design
    └── app.js          # Frontend logic
```

---

## 🧠 Design Write-Up

### How Personas Are Modeled

Each of the four executives (CFO, CMO, COO, CSO) is defined by a **system prompt** that encodes:
- Their role, priorities, and decision-making lens
- Their interpersonal dynamics (who they clash with, who they align with)
- Their communication style and level of bluntness

The personas are intentionally designed with **productive tension**: the CFO pushes for margin discipline, the CMO argues for protecting growth investment, the COO finds operational solutions, and the CSO zooms out to strategic risk. This mirrors how real executive teams argue.

### How the Discussion Works

Each CEO message triggers **8 sequential Gemini API calls** in two rounds:

**Round 1 (Initial Perspectives):** CFO → CMO → COO → CSO each read the CEO's question and any uploaded P&L data, then respond independently from their role's perspective.

**Round 2 (Debate):** Each persona reads all four Round 1 responses and generates a follow-up — agreeing where it makes sense, but explicitly pushing back on disagreements and calling out colleagues by name. This creates the feel of a live debate rather than four isolated answers.

### Data Grounding

Uploaded CSV/JSON files are parsed and injected into every prompt as a formatted table. Each persona's system prompt explicitly instructs them to reference specific numbers when data is available. This prevents the board from giving generic advice when actual P&L figures are on the table.

### Session Persistence

Sessions are stored as JSON files in the `sessions/` directory. Each session contains the full message history, uploaded data, and metadata. The frontend loads the most recent session on startup and allows switching between sessions.

### What's Missing (Production Roadmap)

| Gap | Production Solution |
|-----|-------------------|
| No streaming | Use SSE or WebSockets to stream each persona's response token-by-token |
| Sequential API calls (slow) | Parallelize Round 1 calls; only Round 2 needs to be sequential |
| No auth | Add session-scoped auth (e.g., Clerk or Supabase Auth) |
| File storage in local disk | Use S3/GCS for uploaded files |
| JSON file sessions | Replace with PostgreSQL + vector embeddings for semantic search over history |
| No memory across sessions | Add RAG layer to retrieve relevant past decisions |
| Single model for all personas | Fine-tune or use different temperature/sampling per persona for more distinct voices |

### Assumptions

- `gemini-2.0-flash` is used for speed and cost efficiency at prototype scale
- P&L data is flat CSV (one row per period) — no nested financials
- No authentication is needed for a prototype demo
- The 8-call round-trip (~15-30 seconds) is acceptable latency for a board deliberation metaphor

---

## 📋 API Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/sessions` | GET | List all sessions |
| `/api/session/new` | POST | Create a new session |
| `/api/session/:id` | GET | Get session with full history |
| `/api/session/:id/message` | POST | Send CEO message, get board response |
| `/api/session/:id/upload` | POST | Upload P&L CSV or JSON |
| `/api/session/:id` | DELETE | Delete a session |
