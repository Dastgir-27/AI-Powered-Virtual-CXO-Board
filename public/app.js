/* ─── Virtual CXO Board — Frontend Logic ─────────────────────────────────── */

const API = "";                   // same origin
let currentSessionId = null;
let isLoading = false;

// ─── Persona config ────────────────────────────────────────────────────────────
const PERSONA = {
  CFO: { name: "Alex Chen",     title: "CFO · Chief Financial Officer",  initials: "AC", cls: "cfo" },
  CMO: { name: "Priya Sharma",  title: "CMO · Chief Marketing Officer",  initials: "PS", cls: "cmo" },
  COO: { name: "Marcus Williams",title: "COO · Chief Operating Officer", initials: "MW", cls: "coo" },
  CSO: { name: "Jordan Park",   title: "CSO · Chief Strategy Officer",   initials: "JP", cls: "cso" },
  CEO: { name: "You (CEO)",     title: "Chief Executive Officer",        initials: "CEO",cls: "ceo" },
  SYSTEM: { name: "System",     title: "",                               initials: "⚙",  cls: "system" },
};

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const sessionSelect      = document.getElementById("sessionSelect");
const newSessionBtn      = document.getElementById("newSessionBtn");
const welcomeNewBtn      = document.getElementById("welcomeNewBtn");
const welcomeScreen      = document.getElementById("welcomeScreen");
const chatContainer      = document.getElementById("chatContainer");
const messages           = document.getElementById("messages");
const messagesWrap       = document.getElementById("messagesWrap");
const messageInput       = document.getElementById("messageInput");
const sendBtn            = document.getElementById("sendBtn");
const thinkingBar        = document.getElementById("thinkingBar");
const thinkingText       = document.getElementById("thinkingText");
const chatTitle          = document.getElementById("chatTitle");
const chatDate           = document.getElementById("chatDate");
const sessionList        = document.getElementById("sessionList");
const fileInput          = document.getElementById("fileInput");
const uploadArea         = document.getElementById("uploadArea");
const uploadStatus       = document.getElementById("uploadStatus");
const newSessionModal    = document.getElementById("newSessionModal");
const sessionTitleInput  = document.getElementById("sessionTitleInput");
const cancelModalBtn     = document.getElementById("cancelModalBtn");
const confirmNewSessionBtn = document.getElementById("confirmNewSessionBtn");
const deleteSessionBtn   = document.getElementById("deleteSessionBtn");

// ─── Utilities ─────────────────────────────────────────────────────────────────
function formatTime(iso) {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}
function formatDate(iso) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function setLoading(state, text = "Board is deliberating…") {
  isLoading = state;
  sendBtn.disabled = state;
  messageInput.disabled = state;
  thinkingBar.style.display = state ? "flex" : "none";
  thinkingText.textContent = text;
}

function scrollToBottom() {
  setTimeout(() => {
    messagesWrap.scrollTo({ top: messagesWrap.scrollHeight, behavior: "smooth" });
  }, 50);
}

// ─── Render message ────────────────────────────────────────────────────────────
function renderMessage(msg) {
  const p = PERSONA[msg.speaker] || PERSONA.SYSTEM;
  const div = document.createElement("div");
  div.className = `message ${msg.speaker.toLowerCase()}`;
  div.dataset.id = msg.id;

  const avatarText = msg.speaker === "CEO" ? "CEO" : (p.initials || msg.speaker);

  div.innerHTML = `
    <div class="message-avatar ${p.cls}">${avatarText}</div>
    <div class="message-body">
      <div class="message-meta">
        <span class="message-name">${p.name}</span>
        ${p.title ? `<span class="message-role">${p.title}</span>` : ""}
        <span class="message-time">${formatTime(msg.timestamp)}</span>
      </div>
      <div class="message-bubble">${escapeHtml(msg.content)}</div>
    </div>
  `;
  return div;
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>");
}

function renderRoundDivider(round) {
  const div = document.createElement("div");
  div.className = "round-divider";
  const label = round === 1 ? "🎙 Round 1 — Initial Perspectives" : "⚡ Round 2 — Board Debate";
  div.innerHTML = `
    <div class="round-divider-line"></div>
    <div class="round-divider-label">${label}</div>
    <div class="round-divider-line"></div>
  `;
  return div;
}

// ─── Load sessions list ────────────────────────────────────────────────────────
async function loadSessionsList() {
  try {
    const res = await fetch(`${API}/api/sessions`);
    const sessions = await res.json();

    // Update dropdown
    const current = sessionSelect.value;
    while (sessionSelect.options.length > 1) sessionSelect.remove(1);
    sessions.forEach((s) => {
      const opt = new Option(s.title, s.id);
      sessionSelect.add(opt);
    });
    if (current) sessionSelect.value = current;

    // Update sidebar list
    if (sessions.length === 0) {
      sessionList.innerHTML = '<p class="empty-state">No sessions yet</p>';
      return;
    }
    sessionList.innerHTML = sessions
      .map(
        (s) => `
      <div class="session-item ${s.id === currentSessionId ? "active" : ""}" data-id="${s.id}" onclick="loadSession('${s.id}')">
        <div class="session-item-title">${escapeHtmlBasic(s.title)}</div>
        <div class="session-item-meta">${formatDate(s.createdAt)} · ${s.messageCount} messages</div>
      </div>`
      )
      .join("");
  } catch (e) {
    console.error("Failed to load sessions:", e);
  }
}

function escapeHtmlBasic(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ─── Load a session ────────────────────────────────────────────────────────────
async function loadSession(id, force = false) {
  if (isLoading && !force) return;
  try {
    const res = await fetch(`${API}/api/session/${id}`);
    if (!res.ok) throw new Error("Session not found");
    const session = await res.json();

    currentSessionId = id;
    sessionSelect.value = id;

    // Show chat area
    welcomeScreen.style.display = "none";
    chatContainer.style.display = "flex";

    // Update header
    chatTitle.textContent = session.title;
    chatDate.textContent = formatDate(session.createdAt);

    // Render messages
    messages.innerHTML = "";
    let lastRound = null;
    session.messages.forEach((msg) => {
      // Insert round dividers
      if (msg.round && msg.round !== lastRound) {
        messages.appendChild(renderRoundDivider(msg.round));
        lastRound = msg.round;
      } else if (!msg.round) {
        lastRound = null;
      }
      messages.appendChild(renderMessage(msg));
    });
    scrollToBottom();

    // Show upload status
    if (session.uploadedFileName) {
      uploadArea.classList.add("has-data");
      uploadStatus.className = "upload-status success";
      uploadStatus.textContent = `✓ ${session.uploadedFileName}`;
    } else {
      uploadArea.classList.remove("has-data");
      uploadStatus.textContent = "";
    }

    // Refresh sidebar highlights
    loadSessionsList();
  } catch (e) {
    alert("Failed to load session: " + e.message);
  }
}

// ─── New session ───────────────────────────────────────────────────────────────
function openNewSessionModal() {
  sessionTitleInput.value = "";
  newSessionModal.style.display = "flex";
  setTimeout(() => sessionTitleInput.focus(), 100);
}

function closeModal() {
  newSessionModal.style.display = "none";
}

async function createNewSession() {
  const title = sessionTitleInput.value.trim() || "New Board Session";
  closeModal();
  try {
    const res = await fetch(`${API}/api/session/new`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    const session = await res.json();
    await loadSessionsList();
    await loadSession(session.id);
  } catch (e) {
    alert("Failed to create session: " + e.message);
  }
}

// ─── Delete session ────────────────────────────────────────────────────────────
async function deleteCurrentSession() {
  if (!currentSessionId) return;
  if (!confirm("Delete this session? This cannot be undone.")) return;
  try {
    await fetch(`${API}/api/session/${currentSessionId}`, { method: "DELETE" });
    currentSessionId = null;
    welcomeScreen.style.display = "flex";
    chatContainer.style.display = "none";
    await loadSessionsList();
  } catch (e) {
    alert("Failed to delete session: " + e.message);
  }
}

// ─── Send message ──────────────────────────────────────────────────────────────
async function sendMessage() {
  if (!currentSessionId) {
    alert("Please start or select a session first.");
    return;
  }
  const content = messageInput.value.trim();
  if (!content || isLoading) return;

  // Append CEO's message to the DOM immediately so it feels responsive
  const tempCeoMsg = {
    id: "temp-ceo",
    speaker: "CEO",
    content: content,
    timestamp: new Date().toISOString()
  };
  welcomeScreen.style.display = "none";
  chatContainer.style.display = "flex";
  messages.appendChild(renderMessage(tempCeoMsg));
  scrollToBottom();

  messageInput.value = "";
  messageInput.style.height = "auto";

  setLoading(true, "Board is deliberating — Round 1…");

  try {
    const res = await fetch(`${API}/api/session/${currentSessionId}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Unknown error");
    }

    const data = await res.json();

    // Re-render full session (pass true to bypass isLoading guard)
    await loadSession(currentSessionId, true);

    // Update title in header
    const sessions = await (await fetch(`${API}/api/sessions`)).json();
    const updated = sessions.find((s) => s.id === currentSessionId);
    if (updated) chatTitle.textContent = updated.title;

  } catch (e) {
    alert("Failed to get board response: " + e.message);
  } finally {
    setLoading(false);
  }
}

// ─── File upload ───────────────────────────────────────────────────────────────
async function uploadFile(file) {
  if (!currentSessionId) {
    alert("Please start or select a session first, then upload data.");
    return;
  }
  const formData = new FormData();
  formData.append("file", file);

  uploadStatus.className = "upload-status";
  uploadStatus.textContent = "Uploading…";

  try {
    const res = await fetch(`${API}/api/session/${currentSessionId}/upload`, {
      method: "POST",
      body: formData,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    uploadArea.classList.add("has-data");
    uploadStatus.className = "upload-status success";
    uploadStatus.textContent = `✓ ${data.fileName} (${data.rows} rows)`;

    // Refresh messages to show system message
    await loadSession(currentSessionId);
  } catch (e) {
    uploadStatus.className = "upload-status error";
    uploadStatus.textContent = "Upload failed: " + e.message;
  }
}

// ─── Auto-resize textarea ──────────────────────────────────────────────────────
messageInput.addEventListener("input", () => {
  messageInput.style.height = "auto";
  messageInput.style.height = Math.min(messageInput.scrollHeight, 160) + "px";
});

// ─── Example question ──────────────────────────────────────────────────────────
function useExample(btn) {
  messageInput.value = btn.textContent.trim();
  messageInput.style.height = "auto";
  messageInput.style.height = Math.min(messageInput.scrollHeight, 160) + "px";

  // Auto-create session if none
  if (!currentSessionId) {
    openNewSessionModal();
  } else {
    messageInput.focus();
  }
}

// ─── Event listeners ───────────────────────────────────────────────────────────
newSessionBtn.addEventListener("click", openNewSessionModal);
welcomeNewBtn.addEventListener("click", openNewSessionModal);
cancelModalBtn.addEventListener("click", closeModal);
confirmNewSessionBtn.addEventListener("click", createNewSession);
deleteSessionBtn.addEventListener("click", deleteCurrentSession);

sessionTitleInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") createNewSession();
  if (e.key === "Escape") closeModal();
});

newSessionModal.addEventListener("click", (e) => {
  if (e.target === newSessionModal) closeModal();
});

sessionSelect.addEventListener("change", () => {
  const id = sessionSelect.value;
  if (id) loadSession(id);
});

sendBtn.addEventListener("click", sendMessage);

messageInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

fileInput.addEventListener("change", () => {
  if (fileInput.files[0]) uploadFile(fileInput.files[0]);
  fileInput.value = "";
});

// Drag & drop on upload area
uploadArea.addEventListener("dragover", (e) => {
  e.preventDefault();
  uploadArea.style.borderColor = "var(--gold)";
});
uploadArea.addEventListener("dragleave", () => {
  uploadArea.style.borderColor = "";
});
uploadArea.addEventListener("drop", (e) => {
  e.preventDefault();
  uploadArea.style.borderColor = "";
  const file = e.dataTransfer.files[0];
  if (file) uploadFile(file);
});

// ─── Init ──────────────────────────────────────────────────────────────────────
(async function init() {
  await loadSessionsList();
  // Auto-load most recent session if any exist
  const res = await fetch(`${API}/api/sessions`);
  const sessions = await res.json();
  if (sessions.length > 0) {
    await loadSession(sessions[0].id);
  }
})();
