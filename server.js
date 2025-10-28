/**
 * KeepOS Print Agent - Local Bridge Server (HTTP Version)
 * --------------------------------------------------------
 * Simplified: No HTTPS, no SSL errors, no certificates.
 */

const express = require("express");
const bodyParser = require("body-parser");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { exec, execSync } = require("child_process");
const net = require("net");

const app = express();
const STORE_PATH = path.join(process.cwd(), "store.json");
const PORT = 9100;

// ==========================================================
// 🔐 LOAD / INIT STORE
// ==========================================================
function loadStore() {
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
  } catch {
    return {};
  }
}
function saveStore(data) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2));
}
const store = loadStore();
if (!store.secret) {
  store.secret = crypto.randomBytes(20).toString("hex");
  saveStore(store);
}

// ==========================================================
// 🌍 CORS Middleware
// ==========================================================
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowedOrigins = [
    "https://keep-os.com",
    "https://www.keep-os.com",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ];
  if (allowedOrigins.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
  } else {
    res.header("Access-Control-Allow-Origin", "*");
  }
  res.header("Access-Control-Allow-Headers", "Content-Type, X-Signature");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

app.use(bodyParser.json({ limit: "1mb" }));

// ==========================================================
// 🧾 HELPER: Printer Discovery
// ==========================================================
function getPrintersSync() {
  try {
    const out = execSync("lpstat -p", { encoding: "utf8" });
    return out
      .split("\n")
      .map((l) => (l.match(/^printer\s+(.+?)\s/) || [])[1])
      .filter(Boolean);
  } catch {
    if (process.platform === "win32") {
      try {
        const out = execSync(
          'powershell "Get-Printer | Select -ExpandProperty Name"',
          { encoding: "utf8" }
        );
        return out
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean);
      } catch {}
    }
    return [];
  }
}

// ==========================================================
// 🧩 ROUTES
// ==========================================================
app.get("/agent/info", (req, res) => {
  const printers = getPrintersSync();
  res.json({
    name: "KeepOS Print Agent",
    version: "0.1.0",
    secret: store.secret,
    defaultPrinter: store.defaultPrinter || null,
    printers,
  });
});

app.post("/printer/select", (req, res) => {
  const { printer } = req.body;
  store.defaultPrinter = printer;
  saveStore(store);
  res.json({ ok: true });
});

function verifyHmac(req, res, next) {
  const signature = req.headers["x-signature"];
  const payload = JSON.stringify(req.body || {});
  const computed = crypto
    .createHmac("sha256", store.secret)
    .update(payload)
    .digest("hex");
  if (!signature || signature !== computed)
    return res.status(401).json({ error: "Invalid signature" });
  next();
}

app.post("/print", verifyHmac, async (req, res) => {
  try {
    const { type, receipt, order, printerName } = req.body;
    const targetPrinter = printerName || store.defaultPrinter;
    if (!targetPrinter)
      return res.status(400).json({ error: "No printer selected" });

    const dataToPrint =
      type === "raw" ? receipt : generateReceiptFromOrder(order);

    await printRawToPrinter(targetPrinter, dataToPrint);
    res.json({ ok: true });
  } catch (err) {
    console.error("❌ Print error:", err);
    res.status(500).json({ error: "Print failed", details: err.message });
  }
});

// ==========================================================
// 🖨️ PRINTING LOGIC
// ==========================================================
async function printRawToPrinter(printerName, rawData) {
  const ipMatch = printerName.match(/^([\d.]+)(?::(\d+))?$/);
  if (ipMatch) {
    const ip = ipMatch[1];
    const port = Number(ipMatch[2] || 9100);
    return sendToTcpPrinter(ip, port, rawData);
  }

  const tmp = path.join(os.tmpdir(), `keepos_receipt_${Date.now()}.bin`);
  fs.writeFileSync(tmp, rawData, "binary");

  return new Promise((resolve, reject) => {
    exec(`lp -o raw -d "${printerName}" "${tmp}"`, (err, stdout, stderr) => {
      fs.unlinkSync(tmp);
      if (err) reject(stderr || err.message);
      else resolve(stdout || "ok");
    });
  });
}

function sendToTcpPrinter(host, port, data) {
  return new Promise((resolve, reject) => {
    const client = new net.Socket();
    client.connect(port, host, () => {
      client.write(data, "binary");
      client.end();
    });
    client.on("close", () => resolve("sent"));
    client.on("error", reject);
  });
}

function generateReceiptFromOrder(order) {
  const ESC = "\x1B";
  const GS = "\x1D";
  let out = `${ESC}@${ESC}a\x01${ESC}E\x01KEEP OS RESTAURANT${ESC}E\x00\n`;
  out += `Order: ${order.id}\n`;
  out += "-------------------------------\n";
  (order.items || []).forEach((i) => {
    out += `${i.quantity}x ${i.name} ${(i.amount / 100).toFixed(2)}\n`;
  });
  out += "-------------------------------\n";
  out += `TOTAL: ${order.total.toFixed(2)}\n`;
  out += "\n\nThank you for your patronage!\n\n\n";
  out += `${GS}V\x41\x03`; // Cut command
  return out;
}

// ==========================================================
// 🚀 START SIMPLE HTTP SERVER
// ==========================================================
function startServer(port) {
  app
    .listen(port, "127.0.0.1", () => {
      console.log(`✅ KeepOS Print Agent running at http://127.0.0.1:${port}`);
    })
    .on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        console.warn(`⚠️ Port ${port} in use. Trying ${port + 1}...`);
        startServer(port + 1);
      } else {
        console.error("Server error:", err);
      }
    });
}

startServer(PORT);
