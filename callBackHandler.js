require("dotenv").config();

const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID || "@cucumverse";

// ─── Helpers ────────────────────────────────────────────────────────────────

function mainMenu() {
  return {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: "🚀 PRESALE",                     callback_data: "presale" }],
        [{ text: "📢 Join Telegram Channel (+5)",   callback_data: "join" }],
        [{ text: "✖️ Follow on X (+5)",             callback_data: "follow" }],
        [{ text: "❤️ Like & Retweet X Post (+15)",  callback_data: "like_retwit" }],
        [{ text: "🔁 Invite Friends (+3/friend)",   callback_data: "invite" }],
        [{ text: "🎁 Daily Rewards",                 callback_data: "daily_rewards" }],
        [{ text: "🚀 Deploy Token (+50)",           callback_data: "deploy" }],
        [{ text: "🏆 Leaderboard",                  callback_data: "leaderboard" }],
        [{ text: "ℹ️ Airdrop Info",                 callback_data: "airdrop_info" }]
      ]
    }
  };
}

function mainMenuText(user) {
  return (
`🎁 *Cucumverse Airdrop Dashboard*

  Wallet: \`${user.wallet}\`
 📊 Your Points: *${user.points}*

Complete tasks below to earn points and qualify for rewards.
Minimum *50 points* required to qualify.
🏆 Top 10 earn *100,000 bonus tokens*!`
  );
}

// ─── Captcha generator ───────────────────────────────────────────────────────

function generateCaptcha() {
  const a = Math.floor(Math.random() * 9) + 1;
  const b = Math.floor(Math.random() * 9) + 1;
  const ops = [
    { symbol: "+", answer: a + b },
    { symbol: "×", answer: a * b },
    { symbol: "-", answer: a - b }
  ];
  const op = ops[Math.floor(Math.random() * ops.length)];
  return { question: `${a} ${op.symbol} ${b}`, answer: op.answer };
}

function captchaKeyboard(correctAnswer) {
  // 3 random wrong options + correct answer, shuffled
  const options = new Set([correctAnswer]);
  while (options.size < 4) {
    const rand = Math.floor(Math.random() * 20) - 4;
    if (rand !== correctAnswer) options.add(rand);
  }
  const shuffled = [...options].sort(() => Math.random() - 0.5);
  return {
    inline_keyboard: [
      shuffled.map(n => ({ text: `${n}`, callback_data: `captcha_${n}` }))
    ]
  };
}

// ─── Main export ─────────────────────────────────────────────────────────────

const mongoose = require("mongoose");
const PresalePurchase = require("./models/PresalePurchase");
const HashState = require("./models/HashState");

// Shared collection — written by cucumber bot, read here for verification
const DeployedToken = mongoose.models.DeployedToken ||
  mongoose.model("DeployedToken", new mongoose.Schema({
    chatId:        { type: Number, required: true, index: true },
    mintAddress:   { type: String },
    symbol:        { type: String },
    tokenName:     { type: String },
    deploymentSig: { type: String },
    createdAt:     { type: Date, default: Date.now }
  }));

module.exports = (bot, User) => {

  // State maps
  const captchaPending = new Map();
  const awaitingWallet = new Set();
  const awaitingPresaleWallet = new Set();

  // ── Exposed helpers for app.js ──────────────────────────────────────────

  module.exports.sendMainMenu = async (bot, chatId, user) => {
    return bot.sendMessage(chatId, mainMenuText(user), mainMenu());
  };

  module.exports.startCaptcha = (bot, chatId) => {
    const captcha = generateCaptcha();
    captchaPending.set(chatId, { answer: captcha.answer, attempts: 0 });

    bot.sendMessage(chatId,
`🔐 *Anti-Bot Verification*

To continue, solve this simple math problem:

❓ What is *${captcha.question}*?`,
      { parse_mode: "Markdown", reply_markup: captchaKeyboard(captcha.answer) }
    );
  };

  // ── Handle text messages ─────────────────────────────────────────────────
  bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    if (msg.from?.is_bot) return;
    const text = msg.text?.trim();
    if (!text) return;

    // ── PRESALE WALLET SUBMISSION ─────────────────────────────────────────
    if (awaitingPresaleWallet.has(chatId)) {
      const isSolana = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(text);
      const isEVM    = /^0x[a-fA-F0-9]{40}$/.test(text);

      if (!isSolana && !isEVM) {
        return bot.sendMessage(chatId,
          "❌ Invalid address. Send a valid Solana or ETH (0x...) wallet address."
        );
      }

      awaitingPresaleWallet.delete(chatId);
      const user = await User.findOne({ chatId });
      if (!user) return;

      // Check if already claimed by another user
      const record = await PresalePurchase.findOne({ presaleWallet: text });

      if (!record) {
        return bot.sendMessage(chatId,
          "❌ No presale purchase found for this wallet.\n\nMake sure you completed a purchase on *cucumverse.space* first.",
          { parse_mode: "Markdown" }
        );
      }

      if (record.claimed && record.chatId !== chatId) {
        return bot.sendMessage(chatId, "❌ This wallet is already linked to another account.");
      }

      if (record.claimed && record.chatId === chatId) {
        return bot.sendMessage(chatId,
          `⚠️ You already verified this presale wallet.\n\n🪙 Your allocation: *${record.ccvAllocation.toLocaleString()} CCV*`,
          { parse_mode: "Markdown" }
        );
      }

      // Award points based on SOL spent
      let bonusPoints = 0;
      if (record.solAmount >= 1)        bonusPoints = 600;
      else if (record.solAmount >= 0.5) bonusPoints = 250;
      else if (record.solAmount > 0)    bonusPoints = 50;

      record.claimed = true;
      record.chatId  = chatId;
      await record.save();

      if (!user.tasks.joinedPresale) {
        user.tasks.joinedPresale = true;
        user.points += 20;
      }
      if (bonusPoints > 0) user.points += bonusPoints;
      await user.save();

      return bot.sendMessage(chatId,
`✅ *Presale wallet verified!*

💼 \`${text}\`
💰 SOL Spent: *${record.solAmount} SOL*
🪙 CCV Allocation: *${record.ccvAllocation.toLocaleString()} CCV*
🎁 Points Awarded: *+${20 + bonusPoints}*

Your token allocation is reserved. Tokens will be distributed after TGE. 🚀`,
        { parse_mode: "Markdown" }
      );
    }

    // ── REWARDS WALLET SUBMISSION ─────────────────────────────────────────
    // ── REWARDS WALLET SUBMISSION ─────────────────────────────────────────
    if (awaitingWallet.has(chatId)) {
      // Solana address: base58, 32–44 chars
      const isSolana = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(text);

      if (!isSolana) {
        return bot.sendMessage(chatId,
          "❌ Invalid Solana wallet address. Please send a valid Solana address (base58, 32–44 characters)."
        );
      }

      awaitingWallet.delete(chatId);

      const user = await User.findOne({ chatId });
      if (!user) return;

      // Check if wallet is already claimed by a different user
      const walletOwner = await User.findOne({ wallet: text, chatId: { $ne: chatId } });
      if (walletOwner) {
        awaitingWallet.add(chatId); // let them try again
        return bot.sendMessage(chatId,
          "❌ That wallet is already linked to another account. Please use a different Solana wallet address."
        );
      }

      const isUpdate = !!user.wallet;
      user.wallet = text;

      if (!user.tasks.submittedWallet) {
        user.tasks.submittedWallet = true;
        user.points += 10;
      }

      await user.save();

      await bot.sendMessage(chatId,
        `✅ *Wallet saved!*\n\`${text}\`\n\n` +
        (isUpdate ? "Your wallet has been updated." : "🎉 *+10 points* for submitting your wallet!"),
        { parse_mode: "Markdown" }
      );

      // Now show the main menu
      return bot.sendMessage(chatId, mainMenuText(user), mainMenu());
    }
  });

  // ── Handle callback queries ───────────────────────────────────────────────
  bot.on("callback_query", async (query) => {
    const chatId = query.message?.chat?.id;
    const action = query.data;
    if (!chatId) return;
    if (query.from?.is_bot) {
      return bot.answerCallbackQuery(query.id, { text: "🤖 Bots are not allowed.", show_alert: true });
    }

    let user = await User.findOne({ chatId });
    if (!user) return;

    // ── CAPTCHA ANSWER ────────────────────────────────────────────────────
    if (action.startsWith("captcha_")) {
      const state = captchaPending.get(chatId);
      if (!state) return bot.answerCallbackQuery(query.id);

      const chosen = parseInt(action.replace("captcha_", ""), 10);

      if (chosen !== state.answer) {
        state.attempts += 1;
        if (state.attempts >= 3) {
          captchaPending.delete(chatId);
          await bot.editMessageText(
            "❌ Too many wrong attempts. Use /start to try again.",
            { chat_id: chatId, message_id: query.message.message_id }
          );
          return bot.answerCallbackQuery(query.id);
        }
        // Edit message to show remaining attempts, keep buttons
        const captcha = generateCaptcha();
        captchaPending.set(chatId, { answer: captcha.answer, attempts: state.attempts });
        await bot.editMessageText(
`🔐 *Anti-Bot Verification*

❌ Wrong! Try again. (${3 - state.attempts} attempt${3 - state.attempts === 1 ? "" : "s"} left)

❓ What is *${captcha.question}*?`,
          { chat_id: chatId, message_id: query.message.message_id, parse_mode: "Markdown", reply_markup: captchaKeyboard(captcha.answer) }
        );
        return bot.answerCallbackQuery(query.id);
      }

      // ✅ Correct
      captchaPending.delete(chatId);
      user.captchaPassed = true;
      await user.save();

      // If user already has a wallet, skip wallet prompt and go to main menu
      if (user.wallet) {
        await bot.editMessageText(
          mainMenuText(user),
          { chat_id: chatId, message_id: query.message.message_id, ...mainMenu() }
        );
        return bot.answerCallbackQuery(query.id);
      }

      awaitingWallet.add(chatId);
      await bot.editMessageText(
`✅ *Verification passed!*

👛 *Enter your Solana Wallet Address*

This wallet will be used for verification and reward distributions.

Please send your Solana wallet address now:`,
        { chat_id: chatId, message_id: query.message.message_id, parse_mode: "Markdown" }
      );
      return bot.answerCallbackQuery(query.id);
    }

    // ── BACK TO MAIN ──────────────────────────────────────────────────────
    if (action === "back_main") {
      return bot.editMessageText(
        mainMenuText(user),
        { chat_id: chatId, message_id: query.message.message_id, ...mainMenu() }
      );
    }

    // ── PRESALE ───────────────────────────────────────────────────────────
    if (action === "presale") {
      const presaleRecord = await PresalePurchase.findOne({ chatId, claimed: true });
      const allocationLine = presaleRecord
        ? `\n✅ *Your Allocation:* ${presaleRecord.ccvAllocation.toLocaleString()} CCV`
        : `\n⏳ No allocation recorded yet.`;

      return bot.editMessageText(
`🚀 *Cucumverse Presale*

💎 Early participants receive:
• Higher reward multipliers 📈
• Exclusive allocation access 🔐
• Bonus airdrop points 🎁

━━━━━━━━━━━━━━━━━━
💰 *Presale Reward Points*

• 🪙 13500 CCV = +50 pts
• 💰 150000 CCV = +250 pts
• 🏆 500000 CCV = +600 pts

━━━━━━━━━━━━━━━━━━
${allocationLine}
━━━━━━━━━━━━━━━━━━
⚠️ *Important:* Paste your wallet address in Submit Presale Wallet for verification and Points`,
        {
          chat_id: chatId,
          message_id: query.message.message_id,
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [{ text: "🌐 Visit Presale Page", url: process.env.PRESALE_URL }],
              [{ text: "💼 Submit Presale Wallet", callback_data: "submit_presale_wallet" }],
              [{ text: "⬅️ Back", callback_data: "back_main" }]
            ]
          }
        }
      );
    }

    // ── SUBMIT PRESALE WALLET ─────────────────────────────────────────────
    if (action === "submit_presale_wallet") {
      if (user.tasks.joinedPresale) {
        return bot.answerCallbackQuery(query.id, { text: "✅ Presale already verified.", show_alert: true });
      }
      awaitingPresaleWallet.add(chatId);
      await bot.answerCallbackQuery(query.id);
      return bot.sendMessage(chatId,
`💼 *Submit Your Presale Wallet*

Enter the wallet address you used to send SOL or ETH on *cucumverse.space*.

This wallet will be permanently linked to your Telegram account — no one else can use it.`,
        { parse_mode: "Markdown" }
      );
    }

    // ── VERIFY PRESALE (legacy — kept for back-compat) ────────────────────
    if (action === "verify_presale") {
      if (user.tasks.joinedPresale) {
        return bot.answerCallbackQuery(query.id, { text: "⚠️ Already completed.", show_alert: false });
      }
      user.tasks.joinedPresale = true;
      user.points += 20;
      await user.save();
      await bot.answerCallbackQuery(query.id, { text: "✅ +20 points! Presale task done.", show_alert: true });
      return bot.editMessageText(mainMenuText(user), { chat_id: chatId, message_id: query.message.message_id, ...mainMenu() });
    }

    // ── JOIN TELEGRAM CHANNEL ─────────────────────────────────────────────
    if (action === "join") {
      return bot.editMessageText(
`📢 *Join Cucumverse Channel*

👇 Step 1: Join our official Telegram channel
👇 Step 2: Click *VERIFY* below`,
        {
          chat_id: chatId,
          message_id: query.message.message_id,
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [{ text: "🔗 Open Channel", url: process.env.TELEGRAM_CHANNEL }],
              [{ text: "✅ VERIFY (+5)", callback_data: "verify_join" }],
              [{ text: "⬅️ Back", callback_data: "back_main" }]
            ]
          }
        }
      );
    }

    // ── VERIFY JOIN ───────────────────────────────────────────────────────
    if (action === "verify_join") {
      try {
        const member = await bot.getChatMember(CHANNEL_ID, chatId);
        const validStatuses = ["member", "administrator", "creator"];
        if (!validStatuses.includes(member.status)) {
          return bot.answerCallbackQuery(query.id, { text: "❌ You haven't joined the channel yet!", show_alert: true });
        }
        if (user.tasks.joined) {
          return bot.answerCallbackQuery(query.id, { text: "⚠️ Already completed.", show_alert: false });
        }
        user.tasks.joined = true;
        user.points += 5;
        await user.save();
        await bot.answerCallbackQuery(query.id, { text: "✅ Verified! +5 points", show_alert: true });
        return bot.editMessageText(mainMenuText(user), { chat_id: chatId, message_id: query.message.message_id, ...mainMenu() });
      } catch {
        return bot.answerCallbackQuery(query.id, { text: "⚠️ Verification failed. Make sure you joined and try again.", show_alert: true });
      }
    }

    // ── FOLLOW ON X ───────────────────────────────────────────────────────
    if (action === "follow") {
      return bot.editMessageText(
`✖️ *Follow Cucumverse on X*

👇 Step 1: Follow our official X account
👇 Step 2: Click *VERIFY* below`,
        {
          chat_id: chatId,
          message_id: query.message.message_id,
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [{ text: "✖️ Follow on X", url: process.env.TWITTER_FOLLOW_URL }],
              [{ text: "✅ VERIFY (+5)", callback_data: "verify_follow" }],
              [{ text: "⬅️ Back", callback_data: "back_main" }]
            ]
          }
        }
      );
    }

    // ── VERIFY FOLLOW ─────────────────────────────────────────────────────
    if (action === "verify_follow") {
      if (user.tasks.followed) {
        return bot.answerCallbackQuery(query.id, { text: "⚠️ Already completed.", show_alert: false });
      }
      user.tasks.followed = true;
      user.points += 5;
      await user.save();
      await bot.answerCallbackQuery(query.id, { text: "✅ +5 points! Follow task done.", show_alert: true });
      return bot.editMessageText(mainMenuText(user), { chat_id: chatId, message_id: query.message.message_id, ...mainMenu() });
    }

    // ── LIKE & RETWEET ────────────────────────────────────────────────────
    if (action === "like_retwit") {
      return bot.editMessageText(
`❤️ *Like & Retweet on X*

👇 Step 1: Like and Retweet our pinned post
👇 Step 2: Click *VERIFY* below`,
        {
          chat_id: chatId,
          message_id: query.message.message_id,
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [{ text: "❤️ Open X Post", url: process.env.TWITTER_POST_URL }],
              [{ text: "✅ VERIFY (+15)", callback_data: "verify_like_retwit" }],
              [{ text: "⬅️ Back", callback_data: "back_main" }]
            ]
          }
        }
      );
    }

    // ── VERIFY LIKE & RETWEET ─────────────────────────────────────────────
    if (action === "verify_like_retwit") {
      if (user.tasks.likedRetwit) {
        return bot.answerCallbackQuery(query.id, { text: "⚠️ Already completed.", show_alert: false });
      }
      user.tasks.likedRetwit = true;
      user.points += 15;
      await user.save();
      await bot.answerCallbackQuery(query.id, { text: "✅ +15 points! Like & Retweet done.", show_alert: true });
      return bot.editMessageText(mainMenuText(user), { chat_id: chatId, message_id: query.message.message_id, ...mainMenu() });
    }

    // ── INVITE FRIENDS ────────────────────────────────────────────────────
    if (action === "invite") {
      const botInfo = await bot.getMe();
      const refLink = `https://t.me/${botInfo.username}?start=ref_${chatId}`;
      const remaining = 3 - user.referralCount;
      const capLine = remaining <= 0
        ? "⚠️ *You've reached the 3 invite limit.*"
        : `🔢 Invites remaining: *${remaining}/3*`;
      return bot.editMessageText(
`🔁 *Invite Friends*

Share your referral link below.
You earn *+3 points* for every friend who joins!
Maximum *3 referrals* per user.

🔗 Your Link:
\`${refLink}\`

👥 Friends Invited: *${user.referralCount}/3*
💰 Points from Referrals: *${user.referralCount * 3}*
${capLine}`,
        {
          chat_id: chatId,
          message_id: query.message.message_id,
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              ...(remaining > 0 ? [[{ text: "📤 Share Link", url: `https://t.me/share/url?url=${encodeURIComponent(refLink)}&text=${encodeURIComponent("Join Cucumverse Airdrop and earn rewards!")}` }]] : []),
              [{ text: "⬅️ Back", callback_data: "back_main" }]
            ]
          }
        }
      );
    }

    // ── UPDATE WALLET (from main menu) ────────────────────────────────────
    if (action === "submit_wallet") {
      awaitingWallet.add(chatId);
      await bot.answerCallbackQuery(query.id);
      return bot.sendMessage(chatId,
`💼 *Update Your Solana Wallet*

Send your new Solana wallet address for verification and reward distributions.

Current wallet: \`${user.wallet}\``,
        { parse_mode: "Markdown" }
      );
    }

    // ── DEPLOY TOKEN ──────────────────────────────────────────────────────
    if (action === "deploy") {
      return bot.editMessageText(
`🚀 *Deploy Your Token*

Launch your own token on the Cucumverse platform and earn *+50 points*!

👇 Step 1: Deploy your token via the link below
👇 Step 2: Click *VERIFY* below`,
        {
          chat_id: chatId,
          message_id: query.message.message_id,
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [{ text: "🚀 Deploy Token", url: process.env.DEPLOY_TOKEN_URL }],
              [{ text: "✅ VERIFY (+50)", callback_data: "verify_deploy" }],
              [{ text: "⬅️ Back", callback_data: "back_main" }]
            ]
          }
        }
      );
    }

    // ── VERIFY DEPLOY ─────────────────────────────────────────────────────
    if (action === "verify_deploy") {
      if (user.tasks.deployed) {
        return bot.answerCallbackQuery(query.id, { text: "⚠️ Already completed.", show_alert: false });
      }

      // Check shared MongoDB for a token deployed by this user in the cucumber bot
      const deployRecord = await DeployedToken.findOne({ chatId });

      if (!deployRecord) {
        return bot.answerCallbackQuery(query.id, {
          text: "❌ No deployed token found. Deploy a token via the Cucumverse bot first.",
          show_alert: true
        });
      }

      user.tasks.deployed = true;
      user.points += 50;
      await user.save();
      await bot.answerCallbackQuery(query.id, { text: "✅ +50 points! Deploy verified.", show_alert: true });
      return bot.editMessageText(
        mainMenuText(user),
        { chat_id: chatId, message_id: query.message.message_id, ...mainMenu() }
      );
    }

    // ── LEADERBOARD ───────────────────────────────────────────────────────
    if (action === "leaderboard") {
      try {
        const top = await User.find().sort({ points: -1 }).limit(10);
        const medals = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];
        const rows = top.map((u, i) => {
          const name = u.username ? `@${u.username}` : `User${u.chatId}`;
          const isYou = u.chatId === chatId ? " ← you" : "";
          return `${medals[i]} ${name} — *${u.points} pts*${isYou}`;
        }).join("\n");
        const userRank = await User.countDocuments({ points: { $gt: user.points } });
        await bot.editMessageText(
`🏆 *Leaderboard — Top 10*

${rows || "No participants yet."}

━━━━━━━━━━━━━━━━━━
📊 Your Rank: *#${userRank + 1}*
💰 Your Points: *${user.points}*`,
          {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [
                [{ text: "⬅️ Back", callback_data: "back_main" }]
              ]
            }
          }
        );
        return bot.answerCallbackQuery(query.id);
      } catch (err) {
        console.error("[leaderboard]", err.message);
        return bot.answerCallbackQuery(query.id, { text: "⚠️ Could not load leaderboard.", show_alert: true });
      }
    }

    // ── AIRDROP INFO ──────────────────────────────────────────────────────
    if (action === "airdrop_info") {
      return bot.editMessageText(
`Get ready to earn rewards just by participating! This is your chance to secure early benefits and maximize your gains before everyone else catches on.

💰 *REWARD DETAILS*

• 🎁 Base Reward: Every verified participant receives a guaranteed bonus
• 👥 Referral Bonus: Earn extra rewards for every friend you invite
• 🥒 Airdrop Pool: All participants will share *50,000,000 tokens worth 10000 $USDT*
• ⚡ Early Birds: Limited-time extra rewards for the first wave of users

📊 *HOW REWARDS WORK*

The more you engage, the more you earn. Completing tasks, inviting users, and staying active will increase your total reward allocation.

• Every participant needs at least *50 points* to qualify for rewards
• 🏆 Top 10 participants will each receive *100,000 bonus tokens*
• 🚀 Point Accumulation: Token deployments and presale participations are key activities for earning and accumulating points

⏳ *LIMITED TIME ONLY*

This airdrop won't last forever. Once the allocation is filled, rewards will be distributed.

• 📦 Token Distribution: Tokens will be distributed after *TGE (Token Generation Event)*

🔥 Don't miss out — start now and claim your share!`,
        {
          chat_id: chatId,
          message_id: query.message.message_id,
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [{ text: "⬅️ Back", callback_data: "back_main" }]
            ]
          }
        }
      );
    }

    // ── DAILY REWARDS ─────────────────────────────────────────────────────
    if (action === "daily_rewards") {
      // Reset count if it's a new day
      const now = new Date();
      if (!user.hashData.lastReset || now.toDateString() !== new Date(user.hashData.lastReset).toDateString()) {
        user.hashData.count = 0;
        user.hashData.lastReset = now;
        await user.save();
      }
      const remaining = 3 - user.hashData.count;
      return bot.editMessageText(
`🎁 *Daily Rewards*

Welcome to Hash Points, where you can elevate your points just by hashing!

💰 *Reward Points:* 5 — 75 points
⛏ *No daily limit — hash as much as you want!*`,
        {
          chat_id: chatId,
          message_id: query.message.message_id,
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [{ text: `🔑 Hash Points${remaining === 0 ? " (limit reached)" : ""}`, callback_data: "hash_points" }],
              [{ text: "⬅️ Back", callback_data: "back_main" }]
            ]
          }
        }
      );
    }

    // ── HASH POINTS ───────────────────────────────────────────────────────
    if (action === "hash_points") {
      // Reset if new day
      const now = new Date();
      if (!user.hashData.lastReset || now.toDateString() !== new Date(user.hashData.lastReset).toDateString()) {
        user.hashData.count = 0;
        user.hashData.lastReset = now;
        await user.save();
      }

      await bot.answerCallbackQuery(query.id);
      return bot.editMessageText(
`🔑 *Hash Points*

Tap the button below to open the hashing app on your device.
Your device will search a range of keys and earn you points!

💰 *Reward:* 5 – 75 points per hash
⛏ *No daily limit — hash as much as you want!*`,
        {
          chat_id: chatId,
          message_id: query.message.message_id,
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [{ text: "⛏ Open Hash App", web_app: { url: process.env.HASH_APP_URL } }],
              [{ text: "⬅️ Back", callback_data: "daily_rewards" }]
            ]
          }
        }
      );
    }

    bot.answerCallbackQuery(query.id);
  });
};
