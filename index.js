// index.js — FBR forwarder that returns raw FBR responses (no wrapper)
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const https = require('https');

const app = express();
app.use(bodyParser.json({ limit: '12mb' }));

// Optional API key protection: set FBR_API_KEYS="key1,key2" in env to enable.
// If no keys set, the proxy allows requests (same behavior as direct VBA->FBR).
const VALID_KEYS = (process.env.FBR_API_KEYS || '').split(',').map(s => s.trim()).filter(Boolean);

function requireApiKey(req, res, next) {
if (VALID_KEYS.length === 0) return next();
const key = req.header('x-api-key') || req.query.api_key || (req.header('authorization') || '').replace(/^Bearer\s+/i,'');
if (!key) return res.status(401).send('Missing API key');
if (!VALID_KEYS.includes(key)) return res.status(403).send('Invalid API key');
next();
}

function buildAxiosConfig(incomingAuthHeader) {
const headers = { 'Content-Type': 'application/json' };
if (incomingAuthHeader) headers['Authorization'] = incomingAuthHeader;

const cfg = { headers, timeout: 60000, responseType: 'text' };

// Mutual TLS support (if you set FBR_PFX_BASE64 in Railway env)
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

function getFbrUrl(action, env) {
// action: 'validate' or 'post'
const e = (env || '').toLowerCase();
if (action === 'validate') {
return e === 'sandbox'
? (process.env.FBR_VALIDATE_SB || 'https://gw.fbr.gov.pk/di_data/v1/di/validateinvoicedata_sb')
: (process.env.FBR_VALIDATE || 'https://gw.fbr.gov.pk/di_data/v1/di/validateinvoicedata');
}
// post
return e === 'sandbox'
? (process.env.FBR_POST_SB || 'https://gw.fbr.gov.pk/di_data/v1/di/postinvoicedata_sb')
: (process.env.FBR_POST || 'https://gw.fbr.gov.pk/di_data/v1/di/postinvoicedata');
}

async function forward(action, req, res) {
try {
const env = req.body.__env || req.header('x-env') || 'production';
const targetUrl = getFbrUrl(action, env);
const authHeader = req.header('Authorization') || req.header('authorization') || '';
const cfg = buildAxiosConfig(authHeader);

// Forward the exact body as sent by VBA (no modification)
const r = await axios.post(targetUrl, req.body, cfg);

// r.data is text (responseType: 'text'), return it raw with the original status code
res.status(r.status || 200).type('application/json').send(r.data);
} catch (err) {
// If FBR returned an error with text body, return that text & status to VBA
if (err.response) {
const status = err.response.status || 500;
const data = err.response.data || (err.response.text || JSON.stringify(err.response));
return res.status(status).type('application/json').send(data);
}
console.error('Forward error:', err.message);
return res.status(500).send(JSON.stringify({ error: err.message }));
}
}

app.post('/validate', requireApiKey, async (req, res) => forward('validate', req, res));
app.post('/post', requireApiKey, async (req, res) => forward('post', req, res));

// Health-check
app.get('/health', (req, res) => res.json({ ok: true, now: new Date().toISOString() }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`FBR proxy running on port ${PORT}`));
