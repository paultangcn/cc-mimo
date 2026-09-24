#!/usr/bin/env node
// claudex-shim: a small HTTP layer between Claude Code and an Anthropic-compatible
// gateway (CLIProxyAPI) that serves non-Anthropic models.
//
// It fixes what breaks when Claude Code talks to such models:
//  1. Subagents / Explore / background helpers ask for claude-* models the gateway
//     does not serve. They are rewritten to the model the same session's main
//     thread is using, so a Grok session spawns Grok subagents, a MiMo session
//     spawns MiMo subagents. If the session's model is unknown, the request is
//     refused instead of guessed.
//  2. Claude Code's server-side web_search tool only exists on Anthropic's API.
//     For models whose provider has its own native web search (e.g. Xiaomi MiMo),
//     the search is run on that provider and its citations are returned as real
//     web_search_tool_result blocks, so Claude Code shows the source links.
// Everything else is passed through to the gateway byte for byte.

const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ---------- config ----------

function expandHome(p) { return p && p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p; }

const CONFIG_PATH = expandHome(process.env.CLAUDEX_SHIM_CONFIG || '~/.config/claudex/shim.json');
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

const LISTEN_HOST = config.listen?.host || '127.0.0.1';
const LISTEN_PORT = config.listen?.port || 8319;
const UPSTREAM = new URL(config.upstream || 'http://127.0.0.1:8317');
const UPSTREAM_KEY = config.upstreamApiKey || '';
const STATE_FILE = expandHome(config.stateFile || '~/.local/state/claudex/session-models.json');
const NATIVE_SEARCH = (config.nativeWebSearch || []).map((r) => ({ ...r, re: new RegExp(r.models, 'i') }));

function log(...a) { console.log(new Date().toISOString(), ...a); }

// Reads base-url / api-key of one openai-compatibility provider from a CLIProxyAPI
// config, so the key lives in one place. Deliberately a tiny line scanner, not a
// YAML parser: it only needs `- name: "<provider>"`, `base-url:` and the first `api-key:`.
function readCliProxyProvider(file, provider) {
  const lines = fs.readFileSync(expandHome(file), 'utf8').split('\n');
  let indent = -1, baseUrl = null, apiKey = null;
  for (const line of lines) {
    const m = line.match(/^(\s*)-\s*name:\s*"?([^"\s]+)"?\s*$/);
    if (m && m[2] === provider) { indent = m[1].length; continue; }
    if (indent < 0) continue;
    if (m && m[1].length <= indent) break; // next provider
    const b = line.match(/^\s*base-url:\s*"?([^"\s]+)"?/); if (b) baseUrl = b[1];
    const k = line.match(/^\s*-\s*api-key:\s*"?([^"\s]+)"?/); if (k && !apiKey) apiKey = k[1];
  }
  if (!baseUrl || !apiKey) throw new Error(`provider "${provider}" not found (or incomplete) in ${file}`);
  return { baseUrl, apiKey };
}

function searchEndpoint(rule) {
  if (rule.fromCliProxyAPI) return readCliProxyProvider(rule.fromCliProxyAPI.config, rule.fromCliProxyAPI.provider);
  const apiKey = rule.apiKey || (rule.apiKeyEnv && process.env[rule.apiKeyEnv]);
  if (!rule.baseUrl || !apiKey) throw new Error(`nativeWebSearch rule "${rule.models}" needs baseUrl and apiKey/apiKeyEnv/fromCliProxyAPI`);
  return { baseUrl: rule.baseUrl, apiKey };
}

// ---------- which model is a session on ----------

const sessionModel = new Map(); // x-claude-code-session-id -> main-thread model
try { for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')))) sessionModel.set(k, v); } catch {}

function rememberModel(sid, model) {
  if (sessionModel.get(sid) === model) return;
  sessionModel.set(sid, model);
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(Object.fromEntries(sessionModel)));
}

// Models the gateway serves. CLIProxyAPI lists them twice: by real name on the
// OpenAI-style listing, and under claude-* aliases on the Anthropic-style listing
// (used by Claude Code's gateway model discovery). Served aliases are real models
// and must not be rewritten; aliasToReal lets search rules match them by real name.
const servedIds = new Set();
const aliasToReal = new Map();

function getJson(pathname, headers) {
  return new Promise((resolve, reject) => {
    http.get({ host: UPSTREAM.hostname, port: UPSTREAM.port, path: pathname, headers }, (r) => {
      let d = ''; r.on('data', (c) => (d += c));
      r.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

async function refreshModels() {
  try {
    const auth = { 'x-api-key': UPSTREAM_KEY, authorization: 'Bearer ' + UPSTREAM_KEY };
    const [openai, anthropic] = await Promise.all([
      getJson('/v1/models', auth),
      getJson('/v1/models?limit=1000', { ...auth, 'anthropic-version': '2023-06-01' }),
    ]);
    const real = new Set((openai.data || []).map((m) => m.id));
    servedIds.clear(); aliasToReal.clear();
    for (const m of anthropic.data || []) {
      servedIds.add(m.id);
      const guess = m.id.replace(/^claude-[a-z]+-\d+-dd-/, '').split('').reverse().join('');
      if (m.id !== guess && real.has(guess)) aliasToReal.set(m.id, guess);
    }
  } catch (e) { log('model list refresh failed:', e.message); }
}
refreshModels();
setInterval(refreshModels, 10 * 60 * 1000);

const realName = (model) => aliasToReal.get(model) || model;

// ---------- native web search ----------

function textOf(content) {
  if (typeof content === 'string') return content;
  return (content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
}

const isWebSearchTool = (t) => t && typeof t.type === 'string' && t.type.startsWith('web_search_');

function postJson(url, headers, payload) {
  return new Promise((resolve, reject) => {
    const mod = url.protocol === 'http:' ? http : https;
    const r = mod.request(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers } }, (resp) => {
      let data = '';
      resp.on('data', (c) => (data += c));
      resp.on('end', () => {
        if (resp.statusCode !== 200) return reject(new Error(`HTTP ${resp.statusCode}: ${data.slice(0, 500)}`));
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    });
    r.on('error', reject);
    r.end(JSON.stringify(payload));
  });
}

// OpenAI-style chat completion with the provider's built-in web search tool
// ({"type":"web_search"}); citations come back as message.annotations[].url_citation.
async function runNativeSearch(rule, model, reqBody) {
  const { baseUrl, apiKey } = searchEndpoint(rule);
  const messages = [];
  const sys = Array.isArray(reqBody.system) ? reqBody.system.map((s) => s.text).join('\n') : reqBody.system;
  if (sys) messages.push({ role: 'system', content: sys });
  for (const m of reqBody.messages || []) messages.push({ role: m.role, content: textOf(m.content) });
  return postJson(new URL(baseUrl.replace(/\/$/, '') + '/chat/completions'), { authorization: 'Bearer ' + apiKey }, {
    model,
    max_tokens: Math.max(reqBody.max_tokens || 0, 4096),
    messages,
    tools: [{ type: 'web_search' }],
  });
}

function toAnthropicBlocks(reqBody, completion) {
  const msg = completion.choices?.[0]?.message || {};
  const query = textOf(reqBody.messages?.[reqBody.messages.length - 1]?.content).replace(/^Perform a web search for the query:\s*/i, '');
  const id = 'srvtoolu_' + Math.random().toString(36).slice(2, 14);
  const seen = new Set();
  const results = [];
  for (const a of msg.annotations || []) {
    if (a.type !== 'url_citation' || !a.url || seen.has(a.url)) continue;
    seen.add(a.url);
    results.push({ type: 'web_search_result', url: a.url, title: a.title || a.site_name || a.url, encrypted_content: '', page_age: a.publish_time ? a.publish_time.slice(0, 10) : null });
  }
  return {
    blocks: [
      { type: 'server_tool_use', id, name: 'web_search', input: { query } },
      { type: 'web_search_tool_result', tool_use_id: id, content: results },
      { type: 'text', text: msg.content || '' },
    ],
    usage: {
      input_tokens: completion.usage?.prompt_tokens || 0,
      output_tokens: completion.usage?.completion_tokens || 0,
      server_tool_use: { web_search_requests: completion.usage?.web_search_usage?.tool_usage || 1 },
    },
  };
}

function sse(res, event, data) { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); }

async function handleSearch(res, rule, reqBody) {
  const model = realName(reqBody.model);
  const completion = await runNativeSearch(rule, model, reqBody);
  const { blocks, usage } = toAnthropicBlocks(reqBody, completion);
  const msgId = 'msg_' + (completion.id || Date.now());
  log('web_search', model, JSON.stringify(blocks[0].input.query), 'results', blocks[1].content.length);
  if (!reqBody.stream) {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ id: msgId, type: 'message', role: 'assistant', model: reqBody.model, content: blocks, stop_reason: 'end_turn', stop_sequence: null, usage }));
  }
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  sse(res, 'message_start', { type: 'message_start', message: { id: msgId, type: 'message', role: 'assistant', model: reqBody.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: usage.input_tokens, output_tokens: 0 } } });
  blocks.forEach((b, index) => {
    if (b.type === 'text') {
      sse(res, 'content_block_start', { type: 'content_block_start', index, content_block: { type: 'text', text: '' } });
      sse(res, 'content_block_delta', { type: 'content_block_delta', index, delta: { type: 'text_delta', text: b.text } });
    } else if (b.type === 'server_tool_use') {
      sse(res, 'content_block_start', { type: 'content_block_start', index, content_block: { ...b, input: {} } });
      sse(res, 'content_block_delta', { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) } });
    } else {
      sse(res, 'content_block_start', { type: 'content_block_start', index, content_block: b });
    }
    sse(res, 'content_block_stop', { type: 'content_block_stop', index });
  });
  sse(res, 'message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage });
  sse(res, 'message_stop', { type: 'message_stop' });
  res.end();
}

// ---------- proxy ----------

function passthrough(req, res, body) {
  const up = http.request({ host: UPSTREAM.hostname, port: UPSTREAM.port, method: req.method, path: req.url, headers: req.headers }, (ur) => {
    res.writeHead(ur.statusCode, ur.headers);
    ur.pipe(res);
  });
  up.on('error', (e) => { log('upstream error', e.message); if (!res.headersSent) res.writeHead(502); res.end(); });
  up.end(body);
}

function sendError(res, status, type, message) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ type: 'error', error: { type, message } }));
}

async function handle(req, res, body) {
  const isMessages = req.method === 'POST' && req.url.startsWith('/v1/messages');
  if (!isMessages) return passthrough(req, res, body);

  let parsed = null;
  try { parsed = JSON.parse(body.toString('utf8')); } catch {}
  if (!parsed || typeof parsed.model !== 'string') return passthrough(req, res, body);

  const sid = req.headers['x-claude-code-session-id'];
  const agent = req.headers['x-claude-code-agent-id'];
  const tools = parsed.tools || [];
  log('req', parsed.model, agent ? 'agent=' + agent : 'main', parsed.stream ? 'stream' : 'sync',
    'server_tools=' + tools.filter((t) => t.type && t.type !== 'custom').map((t) => t.type).join(',') + ' tools=' + tools.length,
    'effort=' + JSON.stringify(parsed.output_config?.effort || null));

  if (/^claude-/i.test(parsed.model) && !servedIds.has(parsed.model)) {
    const to = sid && sessionModel.get(sid);
    if (!to) {
      log('model', parsed.model, 'REFUSED: session model unknown', sid || 'no-session');
      return sendError(res, 400, 'invalid_request_error', `claudex-shim: cannot tell which model this session uses, refusing to guess a replacement for ${parsed.model}`);
    }
    log('model', parsed.model, '->', to, agent ? 'agent=' + agent : 'main');
    parsed.model = to;
    body = Buffer.from(JSON.stringify(parsed));
    req.headers['content-length'] = String(body.length);
  } else if (sid && !agent) {
    rememberModel(sid, parsed.model);
  }

  if (!req.url.startsWith('/v1/messages/count_tokens') && tools.some(isWebSearchTool)) {
    const rule = NATIVE_SEARCH.find((r) => r.re.test(realName(parsed.model)));
    if (rule) {
      try { return await handleSearch(res, rule, parsed); }
      catch (e) {
        log('web_search failed', e.message);
        return sendError(res, 502, 'api_error', 'native web search failed: ' + e.message);
      }
    }
  }
  passthrough(req, res, body);
}

http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => handle(req, res, Buffer.concat(chunks)).catch((e) => {
    log('handler error', e.stack || e.message);
    if (!res.headersSent) sendError(res, 500, 'api_error', 'claudex-shim internal error');
    else res.end();
  }));
}).listen(LISTEN_PORT, LISTEN_HOST, () => log(`claudex-shim listening on ${LISTEN_HOST}:${LISTEN_PORT} -> ${UPSTREAM.origin} (config ${CONFIG_PATH})`));
