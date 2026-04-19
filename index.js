import express from "express";
import cors from "cors";
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} from "@whiskeysockets/baileys";
import qrcode from "qrcode";

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // for form_params from Zender

// 🔍 Request logger
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  if (req.body && Object.keys(req.body).length) {
    console.log("  Body:", JSON.stringify(req.body));
  }
  next();
});

const SECRET_KEY = "anish-super-secret-123";
const PORT = 7001;
const VERSION = "2.0.0";

// 🧠 Sessions store
const sessions = {};

// ─────────────────────────────────────────────
// ✅ GET /  — Zender check(): reads response.data.version
// ─────────────────────────────────────────────
app.get("/", (_req, res) => {
  res.json({
    status: 200,
    data: {
      version: VERSION,
      connected: Object.values(sessions).filter(s => s.status === "connected").length,
      total: Object.keys(sessions).length,
    }
  });
});

// ─────────────────────────────────────────────
// ✅ GET /accounts/total/:hash/:secret — Zender total(): reads response.data
// ─────────────────────────────────────────────
app.get("/accounts/total/:hash/:secret", (req, res) => {
  const { secret } = req.params;
  if (secret !== SECRET_KEY) {
    return res.status(401).json({ status: 401, data: null });
  }
  res.json({
    status: 200,
    data: {
      total: Object.keys(sessions).length,
      connected: Object.values(sessions).filter(s => s.status === "connected").length,
      version: VERSION,
    }
  });
});

// ─────────────────────────────────────────────
// ✅ POST /accounts/create/:secret — Zender create(): reads response.status == 200, response.data.qr
// ─────────────────────────────────────────────
app.post("/accounts/create/:secret", async (req, res) => {
  const { secret } = req.params;
  if (secret !== SECRET_KEY) {
    return res.status(401).json({ status: 401, data: null });
  }

  const { unique, uid, hash } = req.body;
  if (!unique) {
    return res.json({ status: 400, data: null });
  }

  if (sessions[unique]) {
    // already exists — return current QR or connected status
    const session = sessions[unique];
    return res.json({
      status: 200,
      data: { qr: session.qr, connected: session.status === "connected" }
    });
  }

  // init session placeholder
  sessions[unique] = { status: "initializing", qr: null, sock: null, uid, hash };
  startSession(unique);

  // wait briefly for QR to generate
  await new Promise(r => setTimeout(r, 3000));

  const session = sessions[unique];
  res.json({
    status: 200,
    data: { qr: session?.qr || null, connected: session?.status === "connected" }
  });
});

// ─────────────────────────────────────────────
// ✅ GET /accounts/status/:hash/:unique/:secret — Zender status(): reads response.data
// ─────────────────────────────────────────────
app.get("/accounts/status/:hash/:unique/:secret", (req, res) => {
  const { secret, unique } = req.params;
  if (secret !== SECRET_KEY) {
    return res.status(401).json({ status: 401, data: null });
  }

  const session = sessions[unique];
  res.json({
    status: 200,
    data: {
      connected: session?.status === "connected" ? true : false,
      qr: session?.qr || null,
      status: session?.status || "not_found",
    }
  });
});

// ─────────────────────────────────────────────
// ✅ GET /accounts/delete/:hash/:unique/:secret — Zender delete(): reads response.status
// ─────────────────────────────────────────────
app.get("/accounts/delete/:hash/:unique/:secret", (req, res) => {
  const { secret, unique } = req.params;
  if (secret !== SECRET_KEY) {
    return res.status(401).json({ status: 401 });
  }

  if (sessions[unique]) {
    try { sessions[unique].sock?.end(); } catch (_) {}
    delete sessions[unique];
  }

  res.json({ status: 200 });
});

// ─────────────────────────────────────────────
// ✅ POST /accounts/update/:hash/:unique/:secret — Zender update(): reads response.status
// ─────────────────────────────────────────────
app.post("/accounts/update/:hash/:unique/:secret", (req, res) => {
  const { secret } = req.params;
  if (secret !== SECRET_KEY) {
    return res.status(401).json({ status: 401 });
  }
  res.json({ status: 200 });
});

// ─────────────────────────────────────────────
// ✅ GET /chats/send/:hash/:unique/:secret — Zender send(): reads response.status
// ✅ POST /chats/send/:hash/:unique/:secret — Zender sendPriority()
// ─────────────────────────────────────────────
app.get("/chats/send/:hash/:unique/:secret", (req, res) => {
  res.json({ status: 200 });
});

app.post("/chats/send/:hash/:unique/:secret", async (req, res) => {
  const { secret, unique } = req.params;
  if (secret !== SECRET_KEY) {
    return res.status(401).json({ status: 401 });
  }

  const { recipient, message, id } = req.body;
  const session = sessions[unique];

  if (!session || session.status !== "connected") {
    return res.json({ status: 400, error: "Session not connected" });
  }

  try {
    const jid = recipient.replace(/[^0-9]/g, "") + "@s.whatsapp.net";
    await session.sock.sendMessage(jid, { text: message });
    res.json({ status: 200, data: { id } });
  } catch (err) {
    console.error("❌ Send error:", err);
    res.json({ status: 500, error: err.message });
  }
});

// ─────────────────────────────────────────────
// ✅ GET /contacts/groups/:hash/:unique/:secret
// ─────────────────────────────────────────────
app.get("/contacts/groups/:hash/:unique/:secret", (req, res) => {
  const { secret } = req.params;
  if (secret !== SECRET_KEY) {
    return res.status(401).json({ status: 401 });
  }
  res.json({ status: 200, data: [] });
});

// ─────────────────────────────────────────────
// ✅ GET /contacts/validate/:hash/:unique/:address/:secret
// ─────────────────────────────────────────────
app.get("/contacts/validate/:hash/:unique/:address/:secret", async (req, res) => {
  const { secret, unique, address } = req.params;
  if (secret !== SECRET_KEY) {
    return res.status(401).json({ status: 401 });
  }

  const session = sessions[unique];
  if (!session || session.status !== "connected") {
    return res.json({ status: 400, error: "Session not connected" });
  }

  try {
    const jid = address.replace(/[^0-9]/g, "") + "@s.whatsapp.net";
    res.json({ status: 200, data: { jid } });
  } catch (err) {
    res.json({ status: 500, error: err.message });
  }
});

// ─────────────────────────────────────────────
// ✅ GET /files/garbage/:days
// ─────────────────────────────────────────────
app.get("/files/garbage/:days", (_req, res) => {
  res.json({ status: 200 });
});

// ─────────────────────────────────────────────
// 🚀 Session management
// ─────────────────────────────────────────────
async function startSession(sessionId) {
  try {
    const { state, saveCreds } = await useMultiFileAuthState(`auth/${sessionId}`);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
    });

    sessions[sessionId] = { ...sessions[sessionId], sock, status: "connecting" };

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
      const { connection, qr, lastDisconnect } = update;

      if (qr) {
        sessions[sessionId].qr = await qrcode.toDataURL(qr);
        sessions[sessionId].status = "qr";
        console.log(`📱 QR ready for ${sessionId}`);
      }

      if (connection === "open") {
        sessions[sessionId].status = "connected";
        sessions[sessionId].qr = null;
        console.log(`✅ ${sessionId} connected`);
      }

      if (connection === "close") {
        const shouldReconnect =
          lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
        sessions[sessionId].status = "disconnected";
        if (shouldReconnect) {
          console.log(`🔄 Reconnecting ${sessionId}...`);
          setTimeout(() => startSession(sessionId), 3000);
        }
      }
    });
  } catch (err) {
    console.error(`❌ startSession error for ${sessionId}:`, err.message);
    if (sessions[sessionId]) sessions[sessionId].status = "error";
  }
}

// ─────────────────────────────────────────────
// Legacy endpoints (keep for manual use)
// ─────────────────────────────────────────────
app.post("/instance", async (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) return res.status(400).json({ error: "sessionId required" });
  if (sessions[sessionId]) return res.json({ message: "Session already exists" });

  sessions[sessionId] = { status: "initializing", qr: null, sock: null };
  startSession(sessionId);
  res.json({ message: "Session started", sessionId });
});

app.get("/qr/:sessionId", (req, res) => {
  const session = sessions[req.params.sessionId];
  if (!session || !session.qr) return res.status(404).send("QR not ready");

  const base64Data = session.qr.replace(/^data:image\/png;base64,/, "");
  const img = Buffer.from(base64Data, "base64");
  res.writeHead(200, { "Content-Type": "image/png", "Content-Length": img.length });
  res.end(img);
});

app.get("/status/:sessionId", (req, res) => {
  const session = sessions[req.params.sessionId];
  res.json({ status: session?.status || "not_found" });
});

app.post("/send-message", async (req, res) => {
  try {
    const { sessionId, number, message } = req.body;
    if (!sessionId || !number || !message) {
      return res.status(400).json({ error: "sessionId, number and message are required" });
    }
    const session = sessions[sessionId];
    if (!session || session.status !== "connected") {
      return res.status(400).json({ error: "Session not connected" });
    }
    const jid = number.replace(/[^0-9]/g, "") + "@s.whatsapp.net";
    await session.sock.sendMessage(jid, { text: message });
    res.json({ status: "sent", number: jid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Anish 🚀 WA Server running on port ${PORT}`);
});
