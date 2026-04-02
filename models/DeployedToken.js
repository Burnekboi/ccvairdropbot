const mongoose = require("mongoose");

// Shared collection written by the cucumber bot, read by the airdrop bot
const deployedTokenSchema = new mongoose.Schema({
  chatId:        { type: Number, required: true, index: true },
  mintAddress:   { type: String, required: true },
  symbol:        { type: String, default: null },
  tokenName:     { type: String, default: null },
  deploymentSig: { type: String, default: null },
  createdAt:     { type: Date, default: Date.now }
});

module.exports = mongoose.model("DeployedToken", deployedTokenSchema);
