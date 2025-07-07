const express = require("express");
const bodyParser = require("body-parser");
const dotenv = require("dotenv");
const axios = require("axios");

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());

// Corrected promotion thresholds (in seconds)
const promotions = [
  { seconds: 20, roleId: 116368233 },   // 1 hour
  { seconds: 40, roleId: 112856307 },   // 2 hours
  { seconds: 60, roleId: 112064304 },  // 3.5 hours
  { seconds: 180, roleId: 113240294 }   // 6 hours
];

// Persistent promotion tracking
const fs = require("fs");
const LOG_FILE = "promotion-log.json";

// Load existing promotions
let promotionLog = [];
try {
  promotionLog = JSON.parse(fs.readFileSync(LOG_FILE));
} catch (err) {
  console.warn("Creating new promotion log");
}

// Health monitoring
let lastRequestTime = Date.now();
setInterval(() => {
  if (Date.now() - lastRequestTime > 300000) { // 5 min inactivity
    console.log("🟡 Sending keep-alive ping");
    axios.get(`http://localhost:${PORT}/health`).catch(() => {});
  }
}, 60000);

app.get("/", (req, res) => res.send("✅ Bot is online"));
app.get("/health", (req, res) => res.send("👍 OK")); // For Render.com health checks

app.post("/log-playtime", async (req, res) => {
  lastRequestTime = Date.now();
  const apiKey = req.headers["x-api-key"];
  const { userId, playtime } = req.body;

  // Authorization
  if (apiKey !== process.env.API_KEY) {
    console.log("❌ Unauthorized request");
    return res.status(403).json({ error: "Unauthorized" });
  }

  if (!userId || !playtime) {
    console.log("❌ Invalid request", { userId, playtime });
    return res.status(400).json({ error: "Missing parameters" });
  }

  console.log(`👤 User ${userId} | Playtime: ${Math.floor(playtime/60)} minutes`);

  try {
    // Get current rank
    const currentRank = await getCurrentRank(userId);
    if (!currentRank) {
        console.log(`ℹ️ User ${userId} not in group - skipping`);
        return res.json({ success: true, message: "User not in group" });
    }

    // Check promotions
    for (const promo of promotions) {
      if (playtime >= promo.seconds && currentRank < promo.roleId) {
        const alreadyPromoted = promotionLog.some(entry => 
          entry.userId === userId && entry.roleId === promo.roleId
        );

        if (!alreadyPromoted) {
          const success = await promoteUser(userId, promo.roleId);
          if (success) {
            console.log(`✅ Promoted ${userId} to ${promo.roleId}`);
            await sendWebhook(userId, promo.roleId, playtime);
            
            // Update log
            promotionLog.push({
              userId,
              roleId: promo.roleId,
              timestamp: new Date().toISOString()
            });
            fs.writeFileSync(LOG_FILE, JSON.stringify(promotionLog, null, 2));
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

// Get user's current rank
async function getCurrentRank(userId) {
  try {
    const response = await axios.get(
      `https://groups.roblox.com/v1/groups/${process.env.GROUP_ID}/users/${userId}`,
      { headers: { Cookie: `.ROBLOSECURITY=${process.env.ROBLOX_COOKIE}` } }
    );
    return response.data.role.id;
  } catch (err) {
    console.error("⛔ Rank check failed:", err.response?.data || err.message);
    return null;
  }
}

// Promote user with proper CSRF handling
async function promoteUser(userId, roleId) {
  const url = `https://groups.roblox.com/v1/groups/${process.env.GROUP_ID}/users/${userId}`;
  
  try {
    // Get CSRF token first
    const tokenResponse = await axios.post(
      "https://auth.roblox.com/v2/logout",
      {},
      { headers: { Cookie: `.ROBLOSECURITY=${process.env.ROBLOX_COOKIE}` } }
    );
    
    const csrfToken = tokenResponse.headers["x-csrf-token"];
    
    // Execute promotion
    await axios.patch(url, { roleId }, {
      headers: {
        "X-CSRF-TOKEN": csrfToken,
        "Content-Type": "application/json",
        Cookie: `.ROBLOSECURITY=${process.env.ROBLOX_COOKIE}`
      }
    });
    
    return true;
  } catch (err) {
    console.error("🚫 Promotion failed:", {
      userId,
      roleId,
      status: err.response?.status,
      error: err.response?.data || err.message
    });
    return false;
  }
}

// Send Discord webhook
async function sendWebhook(userId, roleId, playtime) {
  if (!process.env.DISCORD_WEBHOOK) return;
  
  try {
    const hours = (playtime / 3600).toFixed(1);
    await axios.post(process.env.DISCORD_WEBHOOK, {
      embeds: [{
        title: "🔼 Rank Promotion",
        color: 0x00ff00,
        fields: [
          { name: "User ID", value: userId, inline: true },
          { name: "New Rank", value: roleId, inline: true },
          { name: "Playtime", value: `${hours} hours`, inline: true }
        ],
        timestamp: new Date().toISOString()
      }]
    });
  } catch (err) {
    console.error("❌ Webhook failed:", err.message);
  }
}

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔗 Group ID: ${process.env.GROUP_ID}`);
});

// Crash prevention
process.on("uncaughtException", (err) => {
  console.error("💥 Critical Error:", err);
});
process.on("unhandledRejection", (err) => {
  console.error("⚠️ Unhandled Rejection:", err);
});
