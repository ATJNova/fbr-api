const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const axios = require("axios");

const app = express();
app.use(bodyParser.json());
app.use(cors());

// Security key (will come from Render environment)
const API_KEY = process.env.API_KEY;

// Security check
app.use((req, res, next) => {
    const key = req.headers["x-api-key"];
    if (!key || key !== API_KEY) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    next();
});

// Excel will send JSON here
app.post("/submitInvoice", async (req, res) => {
    const invoice = req.body;

    // --- Here we will put FBR logic later ---

    // For now, just return what Excel sent
    res.json({
        ok: true,
        message: "Invoice received successfully",
        receivedData: invoice
    });
});

// Run server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("API running on port " + PORT));
