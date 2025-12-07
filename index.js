// index.js — FBR Forwarder Proxy (Railway Ready)
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const https = require('https');

const app = express();
app.use(bodyParser.json({ limit: '12mb' }));

// --- API Key (optional)
const VALID_KEYS = (process.env.FBR_API_KEYS || '').split(',').map(s => s.trim()).filter(Boolean);
function requireApiKey(req, res, next) {
  if (VALID_KEYS.length === 0) return next();
  const key = req.header('x-api-key') || req.query.api_key || '';
  if (!key) return res.status(401).send('Missing API key (x-api-key header)');
  if (!VALID_KEYS.includes(key)) return res.status(403).send('Invalid API key');
  next();
}

// --- Axios config
function buildAxiosConfig(incomingAuthHeader) {
  const headers = { 'Content-Type': 'application/json' };
  if (incomingAuthHeader && incomingAuthHeader.trim() !== '') {
    headers['Authorization'] = incomingAuthHeader.trim();
    console.log('Forwarding Authorization header:', headers['Authorization']);
  } else {
    console.warn('No Authorization header received from client.');
  }

  const cfg = { headers, timeout: 60000, responseType: 'text' };

  // Optional Mutual TLS (if FBR requires client cert)
  if (process.env.FBR_PFX_BASE64) {
    try {
      const pfx = Buffer.from(process.env.FBR_PFX_BASE64, 'base64');
      const passphrase = process.env.FBR_PFX_PASS || '';
      cfg.httpsAgent = new https.Agent({ pfx, passphrase, rejectUnauthorized: true });
    } catch (e) {
      console.error('Error loading PFX:', e.message);
    }
  }

  return cfg;
}

// --- FBR URL resolver
function getFbrUrl(action, env) {
  const e = (env || '').toLowerCase();
  if (action === 'validate') {
    return e === 'sandbox'
      ? (process.env.FBR_VALIDATE_SB || 'https://gw.fbr.gov.pk/di_data/v1/di/validateinvoicedata_sb')
      : (process.env.FBR_VALIDATE || 'https://gw.fbr.gov.pk/di_data/v1/di/validateinvoicedata');
  }
  return e === 'sandbox'
    ? (process.env.FBR_POST_SB || 'https://gw.fbr.gov.pk/di_data/v1/di/postinvoicedata_sb')
    : (process.env.FBR_POST || 'https://gw.fbr.gov.pk/di_data/v1/di/postinvoicedata');
}

// --- Forward request to FBR (fixed for Railway)
async function forward(action, req, res) {
  try {
    console.log('--- INCOMING REQUEST ---');
    console.log('Path:', req.path);
    console.log('Headers:', JSON.stringify(req.headers, null, 2));
    console.log('Body preview:', JSON.stringify(req.body).slice(0, 1200));
    console.log('------------------------');

    const env = req.body.__env || req.header('x-env') || 'production';
    const targetUrl = getFbrUrl(action, env);

    const authHeader = req.header('Authorization') || req.header('authorization') || '';
    const cfg = buildAxiosConfig(authHeader);

    // --- FORCE STRINGS for seller & buyer registration numbers
    if (req.body.sellerNTNCNIC) req.body.sellerNTNCNIC = String(req.body.sellerNTNCNIC);
    if (req.body.buyerNTNCNIC) req.body.buyerNTNCNIC = String(req.body.buyerNTNCNIC);

    // --- FORCE STRINGS for items fields
    if (Array.isArray(req.body.items)) {
      req.body.items.forEach(item => {
        if (item.hsCode) item.hsCode = String(item.hsCode);
        if (item.rate) item.rate = String(item.rate);
        if (item.extraTax) item.extraTax = String(item.extraTax);
        if (item.sroScheduleNo) item.sroScheduleNo = String(item.sroScheduleNo);
        if (item.saleType) item.saleType = String(item.saleType);
      });
    }

    // --- Send raw JSON string to FBR
    const jsonString = JSON.stringify(req.body);
    const r = await axios.post(targetUrl, jsonString, cfg);

    // --- Forward response to client
    res.status(r.status || 200).type('application/json').send(r.data);

  } catch (err) {
    if (err.response) {
      const status = err.response.status || 500;
      const data = err.response.data || (err.response.text || JSON.stringify(err.response));
      console.error('FBR responded with error status:', status, 'body preview:', JSON.stringify(data).slice(0, 1000));
      return res.status(status).type('application/json').send(data);
    }
    console.error('Forward error:', err.message);
    return res.status(500).send(JSON.stringify({ error: err.message }));
  }
}

// --- Routes
app.post('/validate', requireApiKey, async (req, res) => forward('validate', req, res));
app.post('/post', requireApiKey, async (req, res) => forward('post', req, res));
app.get('/health', (req, res) => res.json({ ok: true, now: new Date().toISOString() }));

// --- Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`FBR proxy running on port ${PORT}`));



