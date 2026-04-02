require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const mongoose = require("mongoose");
const express = require("express");
const cors = require("cors");
const User = require("./models/User");
const PresalePurchase = require("./models/PresalePurchase");
const handleCallbacks = require("./callBackHandler");

// ── Express API (for website to record presale purchases) ─────────────────────
const app = express();
app.use(cors());
app.use(express.json());

// Website POSTs here after a confirmed purchase
app.post("/presale/record", async (req, res) => {
  try {
    const { presaleWallet, solAmount, ccvAllocation, txSignature } = req.body;
    if (!presaleWallet || !solAmount) return res.status(400).json({ error: "Missing fields" });

    await PresalePurchase.findOneAndUpdate(
      { presaleWallet },
      { presaleWallet, solAmount: parseFloat(solAmount), ccvAllocation: parseFloat(ccvAllocation) || 0, txSignature: txSignature || null },
      { upsert: true }
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(process.env.PORT || 3000, () => console.log("✅ API ready"));


// ── Init bot ──────────────────────────────────────────────────────────────────
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

// ── Connect MongoDB ───────────────────────────────────────────────────────────
mongoose.connect(process.env.MONGODB_URI)
  .then(async () => {
    console.log("✅ MongoDB Connected");
    // Drop stale indexes that may conflict with current schema
    try {
      await mongoose.connection.collection("users").dropIndex("telegramId_1");
      console.log("🗑️ Dropped old telegramId_1 index");
    } catch (e) {
      // Index doesn't exist — that's fine
    }
  })
  .catch(err => console.error("❌ MongoDB Error:", err));

// ── Attach callback handlers ──────────────────────────────────────────────────
handleCallbacks(bot, User);

// ── /start command ────────────────────────────────────────────────────────────
bot.onText(/\/start(.*)/, async (msg, match) => {
  const chatId = msg.chat.id;

  // Block bots
  if (msg.from?.is_bot) return;

  const username = msg.from.username || null;
  const param = match[1]?.trim(); // e.g. "ref_123456789"

  let user = await User.findOne({ chatId });

  if (!user) {
    user = new User({ chatId, username });

    // Handle referral
    if (param?.startsWith("ref_")) {
      const referrerId = parseInt(param.replace("ref_", ""));
      if (referrerId && referrerId !== chatId) {
        const referrer = await User.findOne({ chatId: referrerId });

        // Only credit if referrer exists and hasn't hit the 3-invite cap
        if (referrer && referrer.referralCount < 3) {
          user.referredBy = referrerId;
          referrer.points += 3;
          referrer.referralCount += 1;
          if (referrer.referralCount === 3) referrer.tasks.invited = true; // cap reached
          await referrer.save();

          // Notify referrer
          const remaining = 3 - referrer.referralCount;
          const capMsg = remaining === 0 ? "\n⚠️ You've reached the *3 invite limit*." : `\n🔢 Invites remaining: *${remaining}/3*`;
          bot.sendMessage(referrerId,
            `🎉 Someone joined using your referral link! *+3 points*\n💰 Total Points: *${referrer.points}*${capMsg}`,
            { parse_mode: "Markdown" }
          ).catch(() => {});
        }
      }
    }

    await user.save();
  }

  // Always start with captcha on /start
  // captcha handler will skip wallet prompt if user already has one
  handleCallbacks.startCaptcha(bot, chatId);
});
