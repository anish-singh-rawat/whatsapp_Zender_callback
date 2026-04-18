import express from "express";
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  const key = req.headers["x-api-key"];

  if (key !== SECRET_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  next();
});

const SECRET_KEY = "anish-super-secret-123";
console.log("🔥 FILE START");

let sock = null;
let isConnecting = false;

// ✅ WhatsApp init (NON-BLOCKING + SAFE)
async function startWhatsApp() {
  if (isConnecting) return;
  isConnecting = true;

  try {
    const { state, saveCreds } = await useMultiFileAuthState("auth");
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", (update) => {
      const { connection, qr, lastDisconnect } = update;

      if (qr) {
        console.log("📱 Scan QR:");
        qrcode.generate(qr, { small: true });
      }

      if (connection === "close") {
        const shouldReconnect =
          lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;

        console.log("❌ Connection closed, reconnecting...", shouldReconnect);

        if (shouldReconnect) {
          isConnecting = false;
          setTimeout(startWhatsApp, 2000); // 🔥 prevent tight loop
        }
      } else if (connection === "open") {
        console.log("✅ WhatsApp Connected");
        isConnecting = false;
      }
    });

  } catch (err) {
    console.error("❌ WhatsApp Init Error:", err);
    isConnecting = false;
    setTimeout(startWhatsApp, 5000);
  }
}

// 🔥 IMPORTANT: run in background (NOT blocking)
setTimeout(startWhatsApp, 0);

// ✅ Health route (must-have)
app.get("/", (req, res) => {
  console.log("👉 REQUEST HIT /");
  res.json({
    status: "OK",
    message: "WhatsApp Server Running 🚀",
    port: 3003,
  });
});

// ✅ Send message API
app.post("/send", async (req, res) => {
  try {
    const { number, message } = req.body;

    if (!sock) {
      return res.status(500).json({ error: "WhatsApp not connected yet" });
    }

    await sock.sendMessage(number + "@s.whatsapp.net", {
      text: message,
    });

    res.json({ status: "Message sent" });

  } catch (err) {
    console.error("❌ Send Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ✅ Server start (FAST)
app.listen(3003, "0.0.0.0", () => {
  console.log("🚀 Server running on port 3003");
});
