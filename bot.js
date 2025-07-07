const express = require("express");
const bodyParser = require("body-parser");
const dotenv = require("dotenv");
const axios = require("axios");

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());

// Promotion thresholds (in seconds) and corresponding rank IDs
const promotions = [
  { seconds: 20, roleId: 116368233 },   // 1 hour
  { seconds: 30, roleId: 112856307 },   // 2 hours
  { seconds: 40, roleId: 112064304 },  // 3.5 hours
  { seconds: 50, roleId: 113240294 }   // 6 hours
];

// Keeps track of promoted users in this session to avoid duplicate promotions
const promotedUsers = {}; // userId: [rankIds]

app.get("/", (req, res) => {
  res.send("✅ Bot is online!, logged in");
});

app.post("/log-playtime", async (req, res) => {
  const apiKey = req.headers["x-api-key"];
  const { userId, playtime } = req.body;

  if (apiKey !== process.env.API_KEY) {
    return res.status(403).json({ error: "Unauthorized" });
  }

  if (!userId || !playtime) {
    return res.status(400).json({ error: "Missing userId or playtime" });
  }

  console.log(`👤 User ${userId} has ${playtime} seconds`);

  // Promotion logic
  try {
    for (const promo of promotions) {
      if (playtime >= promo.seconds) {
        const alreadyPromoted = promotedUsers[userId]?.includes(promo.roleId);
        if (!alreadyPromoted) {
          const success = await promoteUser(userId, promo.roleId);
          if (success) {
            promotedUsers[userId] = promotedUsers[userId] || [];
            promotedUsers[userId].push(promo.roleId);
            await sendWebhook(userId, promo.roleId, playtime);
            console.log(`✅ Promoted user ${userId} to rank ${promo.roleId}`);
          }
        }
      }
    }
  } catch (err) {
    console.error("❌ Error during promotion:", err.message);
    return res.status(500).json({ error: "Promotion failed" });
  }

  res.json({ success: true, message: "Playtime processed" });
});

// Promote user in group
async function promoteUser(userId, newRank) {
  try {
    const url = `https://groups.roblox.com/v1/groups/${process.env.GROUP_ID}/users/${userId}`;

    // Step 1: Send a fake request to get CSRF token
    let csrfToken = "";
    try {
      await axios.patch(url, { roleId: newRank }, {
        headers: {
          Cookie: `.ROBLOSECURITY=${process.env.ROBLOX_COOKIE}`,
        }
      });
    } catch (err) {
      csrfToken = err.response.headers["x-csrf-token"];
      if (!csrfToken) throw new Error("Failed to fetch CSRF token");
    }

    // Step 2: Send the actual promotion request with CSRF token
    const response = await axios.patch(url, { roleId: newRank }, {
      headers: {
        Cookie: `.ROBLOSECURITY=${process.env.ROBLOX_COOKIE}`,
        "X-CSRF-TOKEN": csrfToken,
        "Content-Type": "application/json"
      }
    });

    return response.status === 200;
  } catch (error) {
    console.error("Promotion failed:", error.response?.data || error.message);
    return false;
  }
}

// Send Discord webhook
async function sendWebhook(userId, roleId, playtime) {
  const embed = {
    title: "🔼 User Promoted",
    color: 0x00ff00,
    fields: [
      { name: "User ID", value: userId.toString(), inline: true },
      { name: "New Rank", value: roleId.toString(), inline: true },
      { name: "Playtime", value: `${Math.floor(playtime / 60)} minutes`, inline: true }
    ],
    timestamp: new Date().toISOString()
  };

  await axios.post(process.env.DISCORD_WEBHOOK_URL, {
    embeds: [embed]
  });
}

// Start the server
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
