const mongoose = require("mongoose");

const VideoSchema = new mongoose.Schema({
  title: { type: String, required: true },
  filePath: { type: String, required: true }, // Corrected field name
  uploadedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Video", VideoSchema);
