require("dotenv").config();
const mongoose = require("mongoose");
const HashState = require("./models/HashState");

const newStart = process.argv[2];
if (!newStart) { console.error("Usage: node resetStart.js <decimal>"); process.exit(1); }

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  await HashState.findOneAndUpdate(
    { _id: "global" },
    { nextStart: newStart, updatedAt: new Date() },
    { upsert: true }
  );
  console.log(`✅ HashState.nextStart set to: ${newStart}`);
  mongoose.disconnect();
}).catch(err => { console.error(err); process.exit(1); });
