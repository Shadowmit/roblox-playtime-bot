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
    await noblox.setCookie('_|WARNING:-DO-NOT-SHARE-THIS.--Sharing-this-will-allow-someone-to-log-in-as-you-and-to-steal-your-ROBUX-and-items.|_CAEaAhAB.06C9469F1E56DB143D51216E12623B4A3CE87BFDE400E9E71DDF0BD3EB8FC7066F2AFF6F43CE50CAD5A425EDC764443187707160EB7098407714A24BDF9CBA50FAD8868E1AC646FDC347D055BE6949D68EC81E1EA3DCCBC8B04B4AA87B838123F9C093DEEC6963A631A06682831D916C01853073E969189D69A2E2715A039BAFF5B95A1E287F650A677A97C512F430555DD422C47D7D48C5829E9BC02BD0D2ED548159D2081CF7A6B4A33DFB9D98304E7CA59261A4969DA3328DC1BED5BEE605F05B8B203EABFD9CD96C733D2A16C436FD38700EB5969A8495B7237DD3159FA6A2BB58A1D0B8A5BFF926053541F1A048879FDD1F67539AB48E2C7CCD47A8BC2FF56B78EDCBD86EDF81928AFB57C4FA9DB342185623BE8D4BBA660F25D1CD67A1D24A94FBF4DD56D753AC03B660002CA155C6F9DCB8893C99898611451D59C303A701755E1DF8D4A5B5555031A391F17AC433A3E3B3F5CE3A94FDE7B199CAA44892EDB398342D6C235BB95548EA0262556B7C2FFE0F8B03756223FAE5817C812500B1E4EC4B1AFAD6E915B317155BD25C1B7F10485DC34C5C515E47128C9BF32F6ED57CC8914F89F16447DD9760C2F91AA4FBB626DC4FF1CAEB121BA8849B4913805CC0DF5A46A5B5D13014D4FB814F65397686DF71899FF7AFA067FEFCED0CFF8C6FF5845CAF7D05C1B948F503A4F98510DAAB922D37186444B34A2D1A1572E32234372CCD0DC65403DEB31AA94E55B9CFC78BCC904249DF0BCF21A69A879B4D6038E2AE7CC44DB161759E39F57981ABB62C629524E52FDD07E3C52665B66E0E51BB71BCD9BEA3A1B9B9E1659906E489E300A9C0813A18503B0669457944597914F3971116FCD21470C0CC421D84F74DE8EE5BA49F46C9584C344E3E6DB509AF9E7D773BD86F9F5550F325C11D8FA93D637652A70070F8F385E8C346CACD3D25437F28A1E29FE1E7694E84D923331AB70FBC3DD659C7491F4EB290E9D0DF9EF935EBA39992644DCE31E5C236ED3F38B049AEB75A5C456688D80E7E7DE07A71F462779F61DF77BDDDE92B0A11D9386C565EF908414BC0ECF53C0A1D23638E4931112E1C321A013E9051EE919E20B839C2D722D2175557DBAB8885D9F66AF087F7398148505A718CF9AE11C4F46F0AF9308C6D36F5FBBB5835D843D48B10461CE0EDCCECE60132AFF2B61FFEC1EAB7A77CD8C06BAB');
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
