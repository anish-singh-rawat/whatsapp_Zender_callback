import express from "express";
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} from "@whiskeysockets/baileys";
import qrcode from "qrcode";

const app = express();
app.use(express.json());

const SECRET_KEY = "anish-super-secret-123";
const PORT = 7001;

const sessions = {};

// Root endpoint — Zender reads version, status, connected from here
app.get("/", (_req, res) => {
  const connected = Object.values(sessions).some(s => s.status === "connected");
  res.json({
    version: "2.0.0",
    status: true,
    connected: connected,
  });
});


app.get("/sessions", (_req, res) => {
  const data = Object.keys(sessions).map((id) => ({
    id: id,
    name: id,
    status: sessions[id].status === "connected" ? "connected" : "disconnected",
  }));

  res.json(data);
});


app.get("/status", (_req, res) => {
  const connected = Object.values(sessions).some(s => s.status === "connected");
  res.json({
    status: true,
    connected: connected,
    version: "2.0.0",
  });
});

app.get("/instance", (_req, res) => {
  res.json({
    status: true,
    message: "Server is running",
  });
});

app.use((req, res, next) => {
    if (req.path.startsWith("/qr")) return next();

  const key = req.headers["x-api-key"];
  if (key !== SECRET_KEY) {
    return res.status(401).json({ error: "You are Unauthorized" });
  }
  next();
});

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

app.post("/instance", async (req, res) => {
  const { sessionId } = req.body;

  if (!sessionId) {
    return res.status(400).json({ error: "sessionId required" });
  }

  if (sessions[sessionId]) {
    return res.json({ message: "Session already exists" });
  }

  sessions[sessionId] = {
    status: "initializing",
    qr: null,
    sock: null
  };

  startSession(sessionId); 

  res.json({ message: "Session started", sessionId });
});


app.get("/qr/:sessionId", (req, res) => {
  const session = sessions[req.params.sessionId];

  if (!session || !session.qr) {
    return res.status(404).send("QR not ready");
  }

  const base64Data = session.qr.replace(/^data:image\/png;base64,/, "");
  const img = Buffer.from(base64Data, "base64");

  res.writeHead(200, {
    "Content-Type": "image/png",
    "Content-Length": img.length,
  });

  res.end(img);
});

// app.get("/status/:sessionId", (req, res) => {
//   const session = sessions[req.params.sessionId];

//   if (!session) {
//     return res.status(404).json({ error: "Session not found" });
//   }

//   res.json({
//     status: session.status,
//   });
// });

app.get("/status/:sessionId", (req, res) => {
  const session = sessions[req.params.sessionId];

  if (!session) {
    return res.json({ status: "disconnected" });
  }

  res.json({
    status: session.status === "connected" ? "connected" : "disconnected",
  });
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
    console.error("❌ Send error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.delete("/session/:sessionId", (req, res) => {
  const sessionId = req.params.sessionId;

  if (sessions[sessionId]) {
    try {
      sessions[sessionId].sock?.end();
    } catch (error) { 
      console.log("test", error);
     }
    delete sessions[sessionId];
  }

  res.json({ message: "Session deleted" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Anish 🚀 WA Server running on port ${PORT}`);
});
