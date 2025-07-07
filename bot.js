require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const fetch = require("node-fetch");
const app = express();
const PORT = process.env.PORT || 3000;

const API_KEY = process.env.API_KEY;
const COOKIE = ".ROBLOSECURITY=" + process.env.ROBLOSECURITY;
const GROUP_ID = process.env.GROUP_ID;
const WEBHOOK_URL = process.env.WEBHOOK_URL;

const PROMOTION_TIERS = [
  { rankId: 2, seconds: 3600 },     // 1 hour
  { rankId: 3, seconds: 7200 },     // 2 hours
  { rankId: 4, seconds: 12600 },    // 3.5 hours
  { rankId: 5, seconds: 21600 },    // 6 hours
];

let playtimeData = {};

app.use(bodyParser.json());

app.post("/log-playtime", async (req, res) => {
  const key = req.headers["x-api-key"];
  if (key !== API_KEY) return res.status(401).send("Unauthorized");

  const { userId, playtime } = req.body;
  if (!userId || !playtime) return res.status(400).send("Invalid payload");

  if (!playtimeData[userId]) playtimeData[userId] = 0;
  playtimeData[userId] += playtime;

  try {
    const currentRank = await getUserRank(userId);

    for (const tier of PROMOTION_TIERS) {
      if (
        playtimeData[userId] >= tier.seconds &&
        currentRank < tier.rankId
      ) {
        await promoteUser(userId, tier.rankId);
        await logToWebhook(userId, playtimeData[userId], tier.rankId);
      }
    }

    res.status(200).send("Playtime logged.");
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});

async function getUserRank(userId) {
  const res = await fetch(`https://groups.roblox.com/v1/users/${userId}/groups`);
  const data = await res.json();
  const group = data.data.find(g => g.id == GROUP_ID);
  return group ? group.role.rank : 0;
}

async function promoteUser(userId, newRank) {
  await fetch(`https://groups.roblox.com/v1/groups/${GROUP_ID}/users/${userId}`, {
    method: "PATCH",
    headers: {
      Cookie: COOKIE,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ roleId: newRank })
  });
}

async function logToWebhook(userId, playtimeSeconds, newRank) {
  const playtimeHours = (playtimeSeconds / 3600).toFixed(2);
  await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      embeds: [
        {
          title: `User Promoted`,
          description: `User ID: **${userId}** was promoted to **Rank ${newRank}** after **${playtimeHours} hours** of playtime.`,
          color: 3066993,
          timestamp: new Date().toISOString()
        }
      ]
    })
  });
}

app.listen(PORT, () => {
  console.log(`Bot listening on port ${PORT}`);
});
