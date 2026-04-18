import express from "express";
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} from "@whiskeysockets/baileys";
import qrcode from "qrcode";

const app = express();
app.use(express.json());

// 🔐 SECRET KEY
const SECRET_KEY = "anish-super-secret-123";

app.get("/", (req, res) => res.send("OK"));
app.get("/sessions", (req, res) => res.json([]));
app.get("/status", (req, res) => res.json({ status: true }));
app.get("/instance", (req, res) => res.json({ instance: "active" }));

// 🔐 Middleware
app.use((req, res, next) => {
  const key = req.headers["x-api-key"];
  if (key !== SECRET_KEY) {
    return res.status(401).json({ error: "You are Unauthorized" });
  }
  next();
});

// 🧠 Store sessions
const sessions = {};

// 🚀 Create Session
async function startSession(sessionId) {
  const { state, saveCreds } = await useMultiFileAuthState(`auth/${sessionId}`);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
  });

  sessions[sessionId] = {
    sock,
    status: "connecting",
    qr: null,
  };

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, qr, lastDisconnect } = update;

    if (qr) {
      sessions[sessionId].qr = await qrcode.toDataURL(qr);
      sessions[sessionId].status = "qr";
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
        setTimeout(() => startSession(sessionId), 2000);
      }
    }
  });
}



// 📱 Create instance
app.post("/instance", async (req, res) => {
  const { sessionId } = req.body;

  if (!sessionId) {
    return res.status(400).json({ error: "sessionId required" });
  }

  if (sessions[sessionId]) {
    return res.json({ message: "Session already exists" });
  }

  await startSession(sessionId);

  res.json({ message: "Session started", sessionId });
});

// 📷 Get QR
app.get("/qr/:sessionId", (req, res) => {
  const session = sessions[req.params.sessionId];

  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  res.json({
    status: session.status,
    qr: session.qr,
  });
});

// 📊 Status
app.get("/status/:sessionId", (req, res) => {
  const session = sessions[req.params.sessionId];

  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  res.json({
    status: session.status,
  });
});

// 📤 Send message
app.post("/send-message", async (req, res) => {
  try {
    const { sessionId, number, message } = req.body;

    const session = sessions[sessionId];

    if (!session || session.status !== "connected") {
      return res.status(400).json({ error: "Session not connected" });
    }

    await session.sock.sendMessage(
      number + "@s.whatsapp.net",
      { text: message }
    );

    res.json({ status: "sent" });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ❌ Delete session
app.delete("/session/:sessionId", (req, res) => {
  const sessionId = req.params.sessionId;

  if (sessions[sessionId]) {
    delete sessions[sessionId];
  }

  res.json({ message: "Session deleted" });
});

// 🚀 Start server
app.listen(3003, "0.0.0.0", () => {
  console.log("Anish 🚀 WA Server running on 3003");
});
