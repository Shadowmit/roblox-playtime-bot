const express = require("express");
const bodyParser = require("body-parser");
const dotenv = require("dotenv");
const axios = require("axios");
const fs = require("fs");

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());

// Corrected promotion thresholds (in seconds)
const promotions = [
  { seconds: 3600, roleId: 116368233 },   // 1 hour
  { seconds: 7200, roleId: 112856307 },   // 2 hours
  { seconds: 12600, roleId: 112064304 },  // 3.5 hours
  { seconds: 21600, roleId: 113240294 }   // 6 hours
];

// Persistent promotion tracking
const LOG_FILE = "promotion-log.json";

// Load existing promotions
let promotionLog = [];
try {
  promotionLog = JSON.parse(fs.readFileSync(LOG_FILE));
} catch (err) {
  console.warn("Creating new promotion log");
  promotionLog = [];
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
app.get("/health", (req, res) => res.send("👍 OK"));

// Middleware to validate API key
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
    // Check promotions
    for (const promo of promotions) {
      if (playtime >= promo.seconds) {
        const alreadyPromoted = promotionLog.some(entry => 
          entry.userId == userId && entry.roleId == promo.roleId
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
          } else {
            console.log(`❌ Failed to promote ${userId} to ${promo.roleId}`);
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

// Fixed CSRF token handling
let csrfToken = "";
let lastTokenRefresh = 0;

// Get CSRF token from Roblox
async function refreshCSRFToken() {
  try {
    const response = await axios.post(
      "https://auth.roblox.com/v2/logout",
      {},
      { 
        headers: { 
          Cookie: `.ROBLOSECURITY=${process.env.ROBLOX_COOKIE}`,
          "Content-Type": "application/json"
        }
      }
    );
    
    csrfToken = response.headers["x-csrf-token"];
    lastTokenRefresh = Date.now();
    console.log("🔄 Refreshed CSRF token");
    return true;
  } catch (error) {
    console.error("❌ Failed to refresh CSRF token:", {
      status: error.response?.status,
      error: error.response?.data || error.message
    });
    return false;
  }
}

// Promote user with proper CSRF handling
async function promoteUser(userId, roleId) {
  const url = `https://groups.roblox.com/v1/groups/${process.env.GROUP_ID}/users/${userId}`;
  
  try {
    // Refresh token if needed
    if (!csrfToken || Date.now() - lastTokenRefresh > 300000) { // 5 minutes
      const refreshed = await refreshCSRFToken();
      if (!refreshed) return false;
    }
    
    // Execute promotion
    const response = await axios.patch(url, { roleId }, {
      headers: {
        "X-CSRF-TOKEN": csrfToken,
        "Content-Type": "application/json",
        Cookie: `.ROBLOSECURITY=${process.env.ROBLOX_COOKIE}`
      }
    });
    
    return response.status === 200;
  } catch (error) {
    // Handle token expiration
    if (error.response?.status === 403 && error.response?.data?.errors?.[0]?.code === 0) {
      console.log("🔄 Token expired, refreshing...");
      const refreshed = await refreshCSRFToken();
      if (refreshed) {
        // Retry once with new token
        try {
          const retryResponse = await axios.patch(url, { roleId }, {
            headers: {
              "X-CSRF-TOKEN": csrfToken,
              "Content-Type": "application/json",
              Cookie: `.ROBLOSECURITY=${process.env.ROBLOX_COOKIE}`
            }
          });
          return retryResponse.status === 200;
        } catch (retryError) {
          console.error("🚫 Promotion failed after retry:", {
            userId,
            roleId,
            status: retryError.response?.status,
            error: retryError.response?.data || retryError.message
          });
        }
      }
    }
    
    console.error("🚫 Promotion failed:", {
      userId,
      roleId,
      status: error.response?.status,
      error: error.response?.data || error.message
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
          { name: "User ID", value: userId.toString(), inline: true },
          { name: "New Rank", value: roleId.toString(), inline: true },
          { name: "Playtime", value: `${hours} hours`, inline: true }
        ],
        timestamp: new Date().toISOString()
      }]
    });
    console.log(`📤 Sent webhook for ${userId}`);
  } catch (err) {
    console.error("❌ Webhook failed:", err.message);
  }
}

// Start server
app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔗 Group ID: ${process.env.GROUP_ID}`);
  
  // Initialize CSRF token on startup
  await refreshCSRFToken();
});

// Crash prevention
process.on("uncaughtException", (err) => {
  console.error("💥 Critical Error:", err);
});
process.on("unhandledRejection", (err) => {
  console.error("⚠️ Unhandled Rejection:", err);
});
