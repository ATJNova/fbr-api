const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const axios = require("axios");

const app = express();
app.use(bodyParser.json());
app.use(cors());

// Secret API key
const API_KEY = "12345";

// Middleware to check API key
app.use((req, res, next) => {
    const key = req.headers["x-api-key"];
    if (key !== API_KEY) {
        return res.status(403).json({status: "error", message: "Unauthorized"});
    }
    next();
});

// Submit Invoice endpoint
app.post("/submitInvoice", async (req, res) => {
    const invoice = req.body;
    try {
        // TODO: Replace with real FBR API call
        // Example: await axios.post("FBR_API_ENDPOINT", invoice);

        // Mock response for testing
        res.json({
            status: "success",
            message: `Invoice ${invoice.invoiceNumber} submitted successfully!`
        });
    } catch (err) {
        res.json({status: "error", message: err.message});
    }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API running on port ${PORT}`));

