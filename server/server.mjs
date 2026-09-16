#!/usr/bin/env node
// Zero-dependency cache/proxy server for the asbplayer LLM analysis feature.
//
//   node server/server.mjs
//
// Responsibilities:
//   1. Hold the LLM API key server-side (so the browser never sees it, and
//      there is no CORS/key-exposure problem when deployed).
//   2. Persist every analysis to disk, keyed by subtitle-line hash, so a line is
//      never analyzed (paid for) twice — across reloads, devices, and users.
//   3. Expose /api/stats + /api/export so the accumulated data can be crunched
//      (e.g. "which grammar points / words show up most across everything I've watched").
//
// Configure via environment variables or a `server/.env` file (see .env.example).

import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeLine, LlmAnalysisError } from './lib/llm.mjs';
import { AnalysisStore, hashLine } from './lib/store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---- tiny .env loader (no dependency) ----------------------------------------
async function loadDotEnv(file) {
    let text;
    try {
        text = await fs.readFile(file, 'utf8');
    } catch {
        return;
    }
    for (const raw of text.split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const eq = line.indexOf('=');
        if (eq === -1) continue;
        const key = line.slice(0, eq).trim();
        let val = line.slice(eq + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
        }
        if (!(key in process.env)) {
            process.env[key] = val;
        }
    }
}

await loadDotEnv(path.join(__dirname, '.env'));

const CONFIG = {
    port: Number(process.env.PORT || 3939),
    apiKey: process.env.LLM_API_KEY || '',
    baseUrl: process.env.LLM_BASE_URL || 'https://api.deepseek.com/v1',
    model: process.env.LLM_MODEL || 'deepseek-chat',
    temperature: Number(process.env.LLM_TEMPERATURE || 0.2),
    dataDir: process.env.DATA_DIR || path.join(__dirname, 'data'),
    publicDir: process.env.PUBLIC_DIR || '',
    allowClientKey: String(process.env.ALLOW_CLIENT_KEY || 'false') === 'true',
    voicevoxUrl: (process.env.VOICEVOX_URL || 'http://127.0.0.1:50021').replace(/\/$/, ''),
    voicevoxSpeaker: process.env.VOICEVOX_SPEAKER || '1',
};

const store = await new AnalysisStore(CONFIG.dataDir).init();

// De-dupe concurrent identical requests (batch may hit the same line twice).
/** @type {Map<string, Promise<object>>} */
const inFlight = new Map();

// ---- helpers -----------------------------------------------------------------
const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

function sendJson(res, status, obj) {
    const buf = Buffer.from(JSON.stringify(obj), 'utf8');
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': buf.length, ...CORS });
    res.end(buf);
}

function readBody(req, limit = 1_000_000) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on('data', (c) => {
            size += c.length;
            if (size > limit) {
                reject(new Error('payload too large'));
                req.destroy();
                return;
            }
            chunks.push(c);
        });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

async function getOrCreateAnalysis(line, { force, apiKey, baseUrl, model, anime, episode }) {
    if (!force) {
        const hit = store.get(line);
        if (hit) {
            // Make sure this episode's file also records the line (once).
            if ((anime || episode) && !store.episodeHas(anime, episode, line)) {
                await store.put(line, hit.analysis, hit.model ?? CONFIG.model, anime, episode);
            }
            return { analysis: hit.analysis, cached: true, model: hit.model };
        }
    }
    const usedModel = CONFIG.allowClientKey && model ? model : CONFIG.model;
    const key = hashLine(line);
    if (inFlight.has(key)) {
        const analysis = await inFlight.get(key);
        await store.put(line, analysis, usedModel, anime, episode);
        return { analysis, cached: true, model: usedModel };
    }
    const config = {
        apiKey: CONFIG.allowClientKey && apiKey ? apiKey : CONFIG.apiKey,
        baseUrl: CONFIG.allowClientKey && baseUrl ? baseUrl : CONFIG.baseUrl,
        model: usedModel,
    };
    const promise = analyzeLine(line, config, { temperature: CONFIG.temperature });
    inFlight.set(key, promise);
    try {
        const analysis = await promise;
        await store.put(line, analysis, usedModel, anime, episode);
        return { analysis, cached: false, model: usedModel };
    } finally {
        inFlight.delete(key);
    }
}

// Proxy VOICEVOX (local neural TTS) so the browser never hits CORS and the
// engine URL stays a server-side concern. Returns a WAV buffer.
async function synthesizeVoicevox(text, speaker) {
    const spk = encodeURIComponent(speaker || CONFIG.voicevoxSpeaker);
    const queryRes = await fetch(`${CONFIG.voicevoxUrl}/audio_query?text=${encodeURIComponent(text)}&speaker=${spk}`, {
        method: 'POST',
    });
    if (!queryRes.ok) {
        throw new Error(`voicevox audio_query ${queryRes.status}`);
    }
    const query = await queryRes.json();
    const synthRes = await fetch(`${CONFIG.voicevoxUrl}/synthesis?speaker=${spk}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'audio/wav' },
        body: JSON.stringify(query),
    });
    if (!synthRes.ok) {
        throw new Error(`voicevox synthesis ${synthRes.status}`);
    }
    return Buffer.from(await synthRes.arrayBuffer());
}

function toCsv(rows) {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = ['hash', 'line', 'translation', 'reading', 'grammar', 'words', 'model', 'createdAt'];
    const lines = [header.join(',')];
    for (const r of rows) {
        const a = r.analysis ?? {};
        lines.push(
            [
                r.hash,
                r.line,
                a.translation ?? '',
                a.reading ?? '',
                (a.grammar ?? []).map((g) => g.pattern).join(' | '),
                (a.tokens ?? []).map((t) => t.surface).join(' '),
                r.model ?? '',
                r.createdAt ?? '',
            ]
                .map(esc)
                .join(',')
        );
    }
    return lines.join('\n');
}

// ---- static SPA serving (optional) ------------------------------------------
const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.map': 'application/json; charset=utf-8',
};

async function serveStatic(req, res, urlPath) {
    if (!CONFIG.publicDir) {
        return false;
    }
    const clean = decodeURIComponent(urlPath.split('?')[0]);
    let rel = path.normalize(clean).replace(/^(\.\.[/\\])+/, '');
    let filePath = path.join(CONFIG.publicDir, rel);
    let stat = await fs.stat(filePath).catch(() => null);
    if (stat && stat.isDirectory()) {
        filePath = path.join(filePath, 'index.html');
        stat = await fs.stat(filePath).catch(() => null);
    }
    if (!stat) {
        // SPA fallback
        filePath = path.join(CONFIG.publicDir, 'index.html');
        stat = await fs.stat(filePath).catch(() => null);
        if (!stat) {
            return false;
        }
    }
    const body = await fs.readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream', ...CORS });
    res.end(body);
    return true;
}

// ---- request handler ---------------------------------------------------------
const server = http.createServer(async (req, res) => {
    try {
        if (req.method === 'OPTIONS') {
            res.writeHead(204, CORS);
            res.end();
            return;
        }
        const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        const route = `${req.method} ${url.pathname}`;

        if (route === 'GET /api/health') {
            sendJson(res, 200, {
                ok: true,
                lines: store.size,
                model: CONFIG.model,
                baseUrl: CONFIG.baseUrl,
                hasKey: Boolean(CONFIG.apiKey),
                allowClientKey: CONFIG.allowClientKey,
                tts: true,
            });
            return;
        }

        if (route === 'POST /api/analyze') {
            const body = JSON.parse((await readBody(req)) || '{}');
            const line = body.line;
            if (!line || !String(line).trim()) {
                sendJson(res, 400, { error: '缺少 line' });
                return;
            }
            if (!CONFIG.apiKey && !(CONFIG.allowClientKey && body.apiKey)) {
                sendJson(res, 400, { error: '服务器未配置 LLM_API_KEY' });
                return;
            }
            try {
                const result = await getOrCreateAnalysis(String(line), {
                    force: Boolean(body.force),
                    apiKey: body.apiKey,
                    baseUrl: body.baseUrl,
                    model: body.model,
                    anime: body.anime,
                    episode: body.episode,
                });
                sendJson(res, 200, result);
            } catch (e) {
                const message = e instanceof LlmAnalysisError ? e.message : String(e?.message || e);
                sendJson(res, 502, { error: message });
            }
            return;
        }

        if (route === 'GET /api/episode') {
            const anime = url.searchParams.get('anime') || '';
            const episode = url.searchParams.get('episode') || '';
            sendJson(res, 200, store.getEpisode(anime, episode));
            return;
        }

        if (route === 'GET /api/library') {
            sendJson(res, 200, { shows: store.library() });
            return;
        }

        if (route === 'GET /api/tts') {
            const text = url.searchParams.get('text') || '';
            const speaker = url.searchParams.get('speaker') || '';
            if (!text.trim()) {
                sendJson(res, 400, { error: '缺少 text' });
                return;
            }
            try {
                const wav = await synthesizeVoicevox(text, speaker);
                res.writeHead(200, {
                    'Content-Type': 'audio/wav',
                    'Content-Length': wav.length,
                    'Cache-Control': 'public, max-age=86400',
                    ...CORS,
                });
                res.end(wav);
            } catch (e) {
                sendJson(res, 502, { error: `VOICEVOX 不可用: ${String(e?.message || e)}` });
            }
            return;
        }

        if (route === 'GET /api/stats') {
            sendJson(res, 200, store.stats());
            return;
        }

        if (route === 'GET /api/export') {
            const format = url.searchParams.get('format') || 'jsonl';
            const rows = store.exportRows();
            if (format === 'csv') {
                const csv = toCsv(rows);
                res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', ...CORS });
                res.end(csv);
            } else {
                const jsonl = rows.map((r) => JSON.stringify(r)).join('\n');
                res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', ...CORS });
                res.end(jsonl);
            }
            return;
        }

        // Fall through to static SPA (if configured).
        if (req.method === 'GET' && (await serveStatic(req, res, url.pathname))) {
            return;
        }

        sendJson(res, 404, { error: 'not found' });
    } catch (e) {
        sendJson(res, 500, { error: String(e?.message || e) });
    }
});

// ---- lifecycle ---------------------------------------------------------------
async function shutdown() {
    try {
        await store.close();
    } catch {
        /* ignore */
    }
    process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Only listen when run directly (not when imported by tests).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    server.listen(CONFIG.port, () => {
        console.log(`[llm-cache] listening on http://localhost:${CONFIG.port}`);
        console.log(`[llm-cache] model=${CONFIG.model} baseUrl=${CONFIG.baseUrl} key=${CONFIG.apiKey ? 'set' : 'MISSING'}`);
        console.log(`[llm-cache] data dir: ${CONFIG.dataDir} (${store.size} cached)`);
        if (CONFIG.publicDir) {
            console.log(`[llm-cache] serving SPA from: ${CONFIG.publicDir}`);
        }
    });
}

export { server, store, CONFIG, getOrCreateAnalysis };
