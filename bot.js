require("dotenv").config();
const express = require("express");
const noblox = require("noblox.js");

const app = express();
const PORT = process.env.PORT || 3000;

const GROUP_ID = Number(process.env.GROUP_ID);
const COOKIE = process.env.ROBLOX_COOKIE;

if (!GROUP_ID || !COOKIE) {
  console.error("❌ Missing GROUP_ID or ROBLOX_COOKIE in .env");
  process.exit(1);
}

const rankConfig = [
  { hours: 1, rank: 2 },
  { hours: 2, rank: 3 },
  { hours: 3.5, rank: 4 },
  { hours: 6, rank: 5 },
];

// Initialize Roblox session
async function initRoblox() {
  try {
    await noblox.setCookie(COOKIE);
    const currentUser = await noblox.getCurrentUser();
    console.log(`✅ Logged in as ${currentUser.UserName} (${currentUser.UserID})`);
  } catch (err) {
    console.error("❌ Failed to log in to Roblox:", err);
    process.exit(1);
  }
}

// Promote function using rank number
async function promoteUser(userId, newRankNumber) {
  try {
    const roles = await noblox.getRoles(GROUP_ID);
    const targetRole = roles.find(r => r.rank === newRankNumber);
    if (!targetRole) {
      console.error(`❌ Rank number ${newRankNumber} not found in group roles.`);
      return false;
    }
    await noblox.setRank(GROUP_ID, userId, targetRole.id);
    console.log(`✅ Promoted user ${userId} to rank ${newRankNumber} (${targetRole.name})`);
    return true;
  } catch (error) {
    console.error("❌ Promotion failed:", error);
    return false;
  }
}

// Mock function for getting playtime in hours — replace with your real logic
async function getPlaytimeHours(userId) {
  // For example, get from your DB or external source
  return 2.5; // hardcoded test value
}

// Endpoint to test promotion (POST with userId in body)
app.use(express.json());
app.post("/promote", async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).send({ error: "Missing userId in request body" });

  try {
    const playtime = await getPlaytimeHours(userId);
    // Get current rank to compare
    const currentRank = await noblox.getRankInGroup(GROUP_ID, userId);

    let promoted = false;
    for (const config of rankConfig) {
      if (playtime >= config.hours && currentRank < config.rank) {
        promoted = await promoteUser(userId, config.rank);
        if (promoted) break;
      }
    }

    if (promoted) {
      return res.send({ message: `User ${userId} promoted based on ${playtime}h playtime.` });
    } else {
      return res.send({ message: `No promotion needed for user ${userId}.` });
    }
  } catch (err) {
    console.error("❌ Error during promotion process:", err);
    return res.status(500).send({ error: "Internal server error" });
  }
});

// Start server
app.listen(PORT, async () => {
  await initRoblox();
  console.log(`🚀 Server running on port ${PORT}`);
});
