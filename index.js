// index.js
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");

const app = express();
app.use(bodyParser.json());
app.use(cors());

// Read API_KEY from DigitalOcean Environment Variables
const API_KEY = process.env.API_KEY;

// Security middleware
app.use((req, res, next) => {
  const key = req.headers["x-api-key"];
  if (!key || key !== API_KEY) {
    return res.status(401).json({ ok: false, message: "Unauthorized" });
  }
  next();
});

// Main route for Excel
app.post("/submitInvoice", async (req, res) => {
  const invoice = req.body;

  // Placeholder: FBR logic can go here later

  res.json({
    ok: true,
    message: "Invoice received successfully",
    receivedData: invoice
  });
});

// Use DigitalOcean assigned PORT
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`API running on App Platform on port ${PORT}`);
});
