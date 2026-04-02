const mongoose = require("mongoose");

const presalePurchaseSchema = new mongoose.Schema({
  presaleWallet: { type: String, required: true, unique: true },
  chatId:        { type: Number, default: null },   // set when bot claims it
  solAmount:     { type: Number, default: 0 },
  ccvAllocation: { type: Number, default: 0 },
  txSignature:   { type: String, default: null },
  claimed:       { type: Boolean, default: false },
  createdAt:     { type: Date, default: Date.now }
});

module.exports = mongoose.model("PresalePurchase", presalePurchaseSchema);
