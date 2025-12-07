// index.js - Robust FBR forwarder (Railway-ready)
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const https = require('https');

const app = express();
app.use(bodyParser.json({ limit: '20mb' }));

// Config from env
const VALID_KEYS = (process.env.FBR_API_KEYS || '').split(',').map(s => s.trim()).filter(Boolean);
// If USE_ENV_TOKEN == "true", the proxy will prefer env token over incoming Authorization header.
// If USE_ENV_TOKEN == "false" (or unset), proxy will prefer incoming Authorization header and fallback to env token.
const USE_ENV_TOKEN = (process.env.USE_ENV_TOKEN || 'false').toLowerCase() === 'true';
const ENV_TOKEN = (process.env.FBR_TOKEN || '').trim();
const FORCE_TOKEN = (process.env.FORCE_FBR_TOKEN || '').trim(); // optional hard force token (highest priority)

function mask(token) {
  if (!token) return '(none)';
  if (token.length <= 8) return token;
  return token.slice(0, 4) + '...' + token.slice(-4);
}

function requireApiKey(req, res, next) {
  if (VALID_KEYS.length === 0) return next();
  const key = (req.header('x-api-key') || req.query.api_key || '').trim();
  if (!key) return res.status(401).json({ error: 'Missing API key (x-api-key header)' });
  if (!VALID_KEYS.includes(key)) return res.status(403).json({ error: 'Invalid API key' });
  next();
}

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

// Build axios config and set Authorization according rules
function buildAxiosConfig(incomingAuthHeader, body) {
  const headers = { 'Content-Type': 'application/json' };

  // Priority:
  // 1) FORCE_FBR_TOKEN (if provided)
  // 2) If USE_ENV_TOKEN=true -> ENV_TOKEN (if provided)
  // 3) If incoming Authorization header present -> use it (when USE_ENV_TOKEN=false)
  // 4) Fallback -> ENV_TOKEN
  let tokenSource = 'none';
  let tokenToUse = '';

  if (FORCE_TOKEN) {
    tokenToUse = FORCE_TOKEN;
    tokenSource = 'FORCE_FBR_TOKEN';
  } else if (USE_ENV_TOKEN && ENV_TOKEN) {
    tokenToUse = ENV_TOKEN;
    tokenSource = 'ENV_TOKEN (USE_ENV_TOKEN=true)';
  } else if (incomingAuthHeader && incomingAuthHeader.trim() !== '' && !USE_ENV_TOKEN) {
    // Accept incoming header exactly as provided (it can be "Bearer <token>" or raw token)
    // Normalize: if starts with "Bearer " leave as-is; otherwise prefix "Bearer "
    let hdr = incomingAuthHeader.trim();
    if (/^Bearer\s+/i.test(hdr)) {
      tokenToUse = hdr.split(/\s+/)[1];
    } else {
      tokenToUse = hdr;
    }
    tokenSource = 'INCOMING_AUTH_HEADER';
  } else if (ENV_TOKEN) {
    tokenToUse = ENV_TOKEN;
    tokenSource = 'ENV_TOKEN (fallback)';
  }

  if (tokenToUse) {
    headers['Authorization'] = 'Bearer ' + tokenToUse;
  }

  // Logging (safe: mask token in logs)
  console.log('Token decision -> source:', tokenSource, ' tokenPreview:', mask(tokenToUse));
  // For debug: also log sellerNTNCNIC if present in body (helps to check token-NTN match)
  try {
    if (body && body.sellerNTNCNIC) console.log('sellerNTNCNIC in body:', body.sellerNTNCNIC);
  } catch (e) { /* ignore */ }

  const cfg = { headers, timeout: 60000, responseType: 'text' };

  // Mutual TLS (optional)
  if (process.env.FBR_PFX_BASE64) {
    try {
      const pfx = Buffer.from(process.env.FBR_PFX_BASE64, 'base64');
      const passphrase = process.env.FBR_PFX_PASS || '';
      cfg.httpsAgent = new https.Agent({ pfx, passphrase, rejectUnauthorized: true });
      console.log('Mutual TLS configured using FBR_PFX_BASE64.');
    } catch (e) {
      console.error('Error loading PFX:', e.message);
    }
  }

  return cfg;
}

async function forward(action, req, res) {
  try {
    console.log('--- INCOMING REQUEST ---');
    console.log('Path:', req.path);
    // show minimal headers (not to leak tokens) but show whether Authorization header was present
    console.log('Has Authorization header:', !!req.header('Authorization'));
    console.log('Has x-api-key header:', !!req.header('x-api-key'));
    console.log('Body preview:', JSON.stringify(req.body).slice(0, 1200));
    console.log('------------------------');

    const env = req.body.__env || req.header('x-env') || req.header('x-env') || 'production';
    const targetUrl = getFbrUrl(action, env);
    const incomingAuth = req.header('Authorization') || req.header('authorization') || '';

    const cfg = buildAxiosConfig(incomingAuth, req.body);

    // Forward to FBR
    const r = await axios.post(targetUrl, req.body, cfg);

    // If FBR returns text, try to parse JSON; otherwise return as-is
    let respData = r.data;
    try {
      respData = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
    } catch (e) {
      // Not JSON - leave as text
    }

    res.status(r.status || 200).json(respData);
  } catch (err) {
    if (err.response) {
      const status = err.response.status || 500;
      const data = err.response.data || (err.response.text || JSON.stringify({ message: err.message }));
      console.error('FBR responded with error status:', status, 'body preview:', JSON.stringify(data).slice(0, 1000));
      // Try to return JSON if possible
      try {
        const parsed = typeof data === 'string' ? JSON.parse(data) : data;
        return res.status(status).json(parsed);
      } catch (e) {
        return res.status(status).type('application/json').send(data);
      }
    }
    console.error('Forward error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

// Routes
app.post('/validate', requireApiKey, async (req, res) => forward('validate', req, res));
app.post('/post', requireApiKey, async (req, res) => forward('post', req, res));
app.get('/health', (req, res) => res.json({ ok: true, now: new Date().toISOString() }));

// Debug endpoint to show token selection (masked)
app.get('/debug-token', (req, res) => {
  const incomingAuth = req.header('Authorization') || req.header('authorization') || '';
  const cfg = buildAxiosConfig(incomingAuth, null);
  res.json({
    USE_ENV_TOKEN,
    FORCE_FBR_TOKEN_set: !!FORCE_TOKEN,
    ENV_TOKEN_set: !!ENV_TOKEN,
    chosenAuthorizationHeaderPreview: cfg.headers['Authorization'] ? mask(cfg.headers['Authorization'].replace(/^Bearer\s+/i, '')) : '(none)'
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`FBR proxy running on port ${PORT}`));


