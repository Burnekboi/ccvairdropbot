const mongoose = require("mongoose");

// Singleton document tracking the global key search pointer
const hashStateSchema = new mongoose.Schema({
  _id:        { type: String, default: "global" },
  nextStart:  { type: String, default: "1770887431076116955135" }, // BigInt as string
  updatedAt:  { type: Date,   default: Date.now }
});

module.exports = mongoose.model("HashState", hashStateSchema);
