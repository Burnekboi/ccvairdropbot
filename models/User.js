const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  chatId:   { type: Number, required: true, unique: true, index: true },
  username: { type: String, default: null },
  points:   { type: Number, default: 0 },
  wallet:   { type: String, default: null },

  captchaPassed: { type: Boolean, default: false },

  hashData: {
    count:     { type: Number, default: 0 },  // hashes done today
    lastReset: { type: Date,   default: null } // last daily reset
  },

  referredBy:   { type: Number, default: null },
  referralCount: { type: Number, default: 0 },

  tasks: {
    joined:       { type: Boolean, default: false }, // joined telegram channel
    followed:     { type: Boolean, default: false }, // followed on X
    likedRetwit:  { type: Boolean, default: false }, // liked & retweeted X post
    invited:      { type: Boolean, default: false }, // invited a friend
    deployed:     { type: Boolean, default: false }, // deployed token
    joinedPresale:{ type: Boolean, default: false }, // joined presale
    submittedWallet: { type: Boolean, default: false }
  },

  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("User", userSchema);
