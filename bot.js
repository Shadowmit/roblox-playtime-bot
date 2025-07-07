const express = require("express");
const bodyParser = require("body-parser");
const dotenv = require("dotenv");
const axios = require("axios");
const fs = require("fs");
const noblox = require("noblox.js");

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());

// Corrected promotion thresholds (in seconds)
const promotions = [
  { seconds: 10, rank: 2 },   // 1 hour
  { seconds: 20, rank: 3 },   // 2 hours
  { seconds: 30, rank: 4 },   // 3.5 hours
  { seconds: 40, rank: 5 }    // 6 hours
];

const LOG_FILE = "promotion-log.json";

let promotionLog = [];
try {
  promotionLog = JSON.parse(fs.readFileSync(LOG_FILE));
} catch (err) {
  console.warn("Creating new promotion log");
  promotionLog = [];
}

let lastRequestTime = Date.now();
setInterval(() => {
  if (Date.now() - lastRequestTime > 300000) {
    console.log("🟡 Sending keep-alive ping");
    axios.get(`http://localhost:${PORT}/health`).catch(() => {});
  }
}, 60000);

app.get("/", (req, res) => res.send("✅ Bot is online"));
app.get("/health", (req, res) => res.send("👍 OK"));

app.use((req, res, next) => {
  if (req.path === "/") return next();
  const apiKey = req.headers["x-api-key"];
  if (apiKey !== process.env.API_KEY) {
    console.log(`❌ Unauthorized request from ${req.ip}`);
    return res.status(403).json({ error: "Unauthorized" });
  }
  next();
});

app.post("/log-playtime", async (req, res) => {
  lastRequestTime = Date.now();
  const { userId, playtime } = req.body;

  if (!userId || !playtime) {
    console.log("❌ Invalid request", { userId, playtime });
    return res.status(400).json({ error: "Missing parameters" });
  }

  console.log(`👤 User ${userId} | Playtime: ${Math.floor(playtime/60)} minutes`);

  try {
    for (const promo of promotions) {
      if (playtime >= promo.seconds) {
        const alreadyPromoted = promotionLog.some(entry => 
          entry.userId == userId && entry.rank == promo.rank
        );

        if (!alreadyPromoted) {
          const success = await promoteUser(userId, promo.rank);
          if (success) {
            console.log(`✅ Promoted ${userId} to rank ${promo.rank}`);
            await sendWebhook(userId, promo.rank, playtime);
            promotionLog.push({
              userId,
              rank: promo.rank,
              timestamp: new Date().toISOString()
            });
            fs.writeFileSync(LOG_FILE, JSON.stringify(promotionLog, null, 2));
          } else {
            console.log(`❌ Failed to promote ${userId} to rank ${promo.rank}`);
          }
        }
      }
    }
    res.json({ success: true });
  } catch (err) {
    console.error("🔥 Promotion error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

async function promoteUser(userId, rank) {
  try {
    await noblox.setRank(Number(process.env.GROUP_ID), Number(userId), rank);
    return true;
  } catch (error) {
    console.error("🚫 Promotion failed:", error);
    return false;
  }
}

async function sendWebhook(userId, rank, playtime) {
  if (!process.env.DISCORD_WEBHOOK) return;

  try {
    const hours = (playtime / 3600).toFixed(1);
    await axios.post(process.env.DISCORD_WEBHOOK, {
      embeds: [
        {
          title: "🔼 Rank Promotion",
          color: 0x00ff00,
          fields: [
            { name: "User ID", value: userId.toString(), inline: true },
            { name: "New Rank", value: rank.toString(), inline: true },
            { name: "Playtime", value: `${hours} hours`, inline: true }
          ],
          timestamp: new Date().toISOString()
        }
      ]
    });
    console.log(`📤 Sent webhook for ${userId}`);
  } catch (err) {
    console.error("❌ Webhook failed:", err.message);
  }
}

app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔗 Group ID: ${process.env.GROUP_ID}`);
  try {
    await noblox.setCookie(process.env.ROBLOX_COOKIE);
    console.log("🔐 Logged in to Roblox successfully");
  } catch (err) {
    console.error("❌ Failed to login with noblox.js:", err);
  }
});

process.on("uncaughtException", (err) => {
  console.error("💥 Critical Error:", err);
});

process.on("unhandledRejection", (err) => {
  console.error("⚠️ Unhandled Rejection:", err);
});
