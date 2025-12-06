const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;

// Simple API key check
const API_KEY = process.env.API_KEY || "12345";

app.post("/submitInvoice", async (req, res) => {
  try {
    const key = req.headers["x-api-key"];
    if (key !== API_KEY) return res.status(401).json({ error: "Unauthorized" });

    const { env, token, invoice, items } = req.body;

    // FBR URLs
    const baseURL = env === "sandbox" ? "https://gw.fbr.gov.pk/di_data/v1/di/" : "https://gw.fbr.gov.pk/di_data/v1/di/";
    const validateURL = baseURL + (env === "sandbox" ? "validateinvoicedata_sb" : "validateinvoicedata");
    const postURL = baseURL + (env === "sandbox" ? "postinvoicedata_sb" : "postinvoicedata");

    const payload = { ...invoice, items };

    // Step 1: Validate
    const valResp = await axios.post(validateURL, payload, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!["00", "valid"].some(v => JSON.stringify(valResp.data).toLowerCase().includes(v))) {
      return res.json({ error: valResp.data.reason || valResp.data.message || "Validation failed" });
    }

    // Step 2: Submit Invoice
    const postResp = await axios.post(postURL, payload, {
      headers: { Authorization: `Bearer ${token}` }
    });

    const irn = postResp.data.invoiceNumber;
    if (!irn) return res.json({ error: "No IRN returned by FBR" });

    // Step 3: Generate QR code base64
    const qrResp = await axios.get(`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${irn}`, {
      responseType: "arraybuffer"
    });

    const qrBase64 = Buffer.from(qrResp.data, "binary").toString("base64");

    res.json({ irn, qrCode: "data:image/png;base64," + qrBase64 });

  } catch (err) {
    res.json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`FBR API running on port ${PORT}`));

