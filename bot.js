require("dotenv").config();
const express = require("express");
const noblox = require("noblox.js");
const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const GROUP_ID = Number(process.env.GROUP_ID);
const logFilePath = path.join(__dirname, "promotion-log.json");

// Rank thresholds (seconds to rankId)
const RANKS = [
  { seconds: 0, rankId: 255 },     // Newcomer
  { seconds: 3600, rankId: 100 },  // Member
  { seconds: 7200, rankId: 101 },  // Regular
  { seconds: 14400, rankId: 102 }, // Veteran
  { seconds: 28800, rankId: 103 }  // Elite
];

function getTargetRank(playtime) {
  let target = RANKS[0].rankId;
  for (const r of RANKS) {
    if (playtime >= r.seconds) {
      target = r.rankId;
    }
  }
  return target;
}

function logPromotion(userId, prevRank, newRank, playtime) {
  const logs = JSON.parse(fs.readFileSync(logFilePath, "utf8"));
  logs.push({
    userId,
    previousRank: prevRank,
    newRank: newRank,
    playtime,
    timestamp: new Date().toISOString()
  });
  fs.writeFileSync(logFilePath, JSON.stringify(logs, null, 2));
}

async function sendWebhook(userId, previousRank, newRank, playtime) {
  const data = {
    embeds: [{
      title: "🎉 User Promoted",
      color: 0x00ff00,
      fields: [
        { name: "UserId", value: userId.toString(), inline: true },
        { name: "Previous Rank", value: previousRank.toString(), inline: true },
        { name: "New Rank", value: newRank.toString(), inline: true },
        { name: "Playtime (hrs)", value: (playtime / 3600).toFixed(2), inline: true }
      ],
      timestamp: new Date().toISOString()
    }]
  };

  await fetch(process.env.DISCORD_WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });
}

// AUTH & STARTUP
(async () => {
  await noblox.setCookie(process.env.ROBLOX_COOKIE);
  const botUser = await noblox.getCurrentUser();
  console.log(`🤖 Logged in as ${botUser.UserName}`);

  app.post("/playtime", async (req, res) => {
    if (req.headers["x-api-key"] !== process.env.API_KEY) {
      return res.status(403).send("Forbidden");
    }

    const { userId, playtime } = req.body;
    if (!userId || !playtime) return res.status(400).send("Missing userId or playtime");

    try {
      const currentRank = await noblox.getRankInGroup(GROUP_ID, userId);
      const targetRank = getTargetRank(playtime);

      if (targetRank > currentRank) {
        await noblox.setRank(GROUP_ID, userId, targetRank);
        logPromotion(userId, currentRank, targetRank, playtime);
        await sendWebhook(userId, currentRank, targetRank, playtime);
        res.send("✅ Promoted");
      } else {
        res.send("ℹ️ No promotion needed");
      }
    } catch (err) {
      console.error("❌ Error:", err);
      res.status(500).send("Server error");
    }
  });

  app.listen(PORT, () => console.log(`🚀 Bot listening on port ${PORT}`));
})();
         
