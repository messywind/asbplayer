#!/usr/bin/env node
// Multi-user asbplayer backend. Media files stay in the browser; this service
// stores accounts, per-user anime archives, and a globally shared LLM cache.

import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeLine, LlmAnalysisError } from './lib/llm.mjs';
import { MultiUserDatabase } from './lib/database.mjs';
import {
    decryptSecret,
    encryptSecret,
    hashPassword,
    parseCookies,
    randomToken,
    sha256,
    verifyPassword,
} from './lib/auth.mjs';
import { hashLine } from './lib/store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSION_COOKIE = 'asbplayer_session';

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
        let value = line.slice(eq + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        if (!(key in process.env)) process.env[key] = value;
    }
}

await loadDotEnv(path.join(__dirname, '.env'));

const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
const CONFIG = {
    port: Number(process.env.PORT || 3939),
    baseUrl: process.env.LLM_BASE_URL || 'https://api.deepseek.com/v1',
    model: process.env.LLM_MODEL || 'deepseek-chat',
    temperature: Number(process.env.LLM_TEMPERATURE || 0.2),
    dataDir,
    databasePath: process.env.DATABASE_PATH || path.join(dataDir, 'asbplayer.sqlite'),
    publicDir: process.env.PUBLIC_DIR || '',
    encryptionSecret: process.env.API_KEY_ENCRYPTION_SECRET || '',
    adminUsername: process.env.ADMIN_USERNAME || 'admin',
    adminPassword: process.env.ADMIN_PASSWORD || '',
    secureCookies: String(process.env.SECURE_COOKIES || 'false') === 'true',
    sessionDays: Math.max(1, Number(process.env.SESSION_DAYS || 30)),
    voicevoxUrl: (process.env.VOICEVOX_URL || 'http://127.0.0.1:50021').replace(/\/$/, ''),
    voicevoxSpeaker: process.env.VOICEVOX_SPEAKER || '1',
};

const database = new MultiUserDatabase(CONFIG.databasePath);
if (database.userCount === 0 && CONFIG.adminPassword) {
    database.createUser(CONFIG.adminUsername, await hashPassword(CONFIG.adminPassword), 'admin');
    console.log(`[auth] bootstrapped administrator: ${CONFIG.adminUsername}`);
} else if (database.userCount === 0) {
    console.warn('[auth] no users exist; set ADMIN_PASSWORD and restart to bootstrap the administrator');
}

const inFlight = new Map();

function sendJson(res, status, object, extraHeaders = {}) {
    const body = Buffer.from(JSON.stringify(object), 'utf8');
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': body.length,
        'Cache-Control': 'no-store',
        ...extraHeaders,
    });
    res.end(body);
}

function readBody(req, limit = 1_000_000) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > limit) {
                reject(new Error('payload too large'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

async function jsonBody(req) {
    try {
        return JSON.parse((await readBody(req)) || '{}');
    } catch {
        throw new HttpError(400, '请求 JSON 格式无效');
    }
}

class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

function publicUser(user) {
    return {
        id: Number(user.id),
        username: user.username,
        role: user.role,
        hasApiKey: Boolean(user.encrypted_api_key),
    };
}

function validateUsername(username) {
    const value = String(username ?? '').trim();
    if (!/^[\p{L}\p{N}_-]{3,32}$/u.test(value)) {
        throw new HttpError(400, '用户名需为 3–32 位字母、数字、下划线或连字符');
    }
    return value;
}

function validatePassword(password) {
    const value = String(password ?? '');
    if (value.length < 10 || value.length > 200) throw new HttpError(400, '密码至少需要 10 位');
    return value;
}

function sessionToken(req) {
    return parseCookies(req.headers.cookie)[SESSION_COOKIE];
}

function currentUser(req) {
    const token = sessionToken(req);
    return token ? database.userForSession(sha256(token)) : undefined;
}

function requireUser(req) {
    const user = currentUser(req);
    if (!user) throw new HttpError(401, '请先登录');
    return user;
}

function requireAdmin(req) {
    const user = requireUser(req);
    if (user.role !== 'admin') throw new HttpError(403, '需要管理员权限');
    return user;
}

function cookieHeader(token, maxAgeSeconds) {
    const secure = CONFIG.secureCookies ? '; Secure' : '';
    return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

function issueSession(userId) {
    const token = randomToken();
    const maxAge = CONFIG.sessionDays * 24 * 60 * 60;
    database.createSession(userId, sha256(token), new Date(Date.now() + maxAge * 1000).toISOString());
    return { token, maxAge };
}

function userApiKey(user) {
    if (!user.encrypted_api_key) throw new HttpError(409, '请先在账号中心填写自己的 LLM API Key');
    if (!CONFIG.encryptionSecret) throw new HttpError(500, '服务器未配置 API_KEY_ENCRYPTION_SECRET');
    try {
        return decryptSecret(user.encrypted_api_key, CONFIG.encryptionSecret);
    } catch {
        throw new HttpError(500, '无法解密 API Key，请联系管理员');
    }
}

async function getOrCreateAnalysis(line, { force = false, user, episodeId }) {
    if (!force) {
        const hit = database.getAnalysis(line);
        if (hit) {
            database.associateAnalysis(user.id, episodeId, line);
            return { analysis: hit.analysis, cached: true, model: hit.model };
        }
    }
    const key = hashLine(line);
    if (inFlight.has(key)) {
        const result = await inFlight.get(key);
        database.associateAnalysis(user.id, episodeId, line);
        return { analysis: result.analysis, cached: true, model: result.model };
    }
    const promise = analyzeLine(
        line,
        { apiKey: userApiKey(user), baseUrl: CONFIG.baseUrl, model: CONFIG.model },
        { temperature: CONFIG.temperature }
    ).then((analysis) => {
        database.putAnalysis(line, analysis, CONFIG.model);
        return { analysis, model: CONFIG.model };
    });
    inFlight.set(key, promise);
    try {
        const result = await promise;
        database.associateAnalysis(user.id, episodeId, line);
        return { ...result, cached: false };
    } finally {
        inFlight.delete(key);
    }
}

async function synthesizeVoicevox(text, speaker) {
    const selected = encodeURIComponent(speaker || CONFIG.voicevoxSpeaker);
    const queryResponse = await fetch(
        `${CONFIG.voicevoxUrl}/audio_query?text=${encodeURIComponent(text)}&speaker=${selected}`,
        { method: 'POST' }
    );
    if (!queryResponse.ok) throw new Error(`voicevox audio_query ${queryResponse.status}`);
    const query = await queryResponse.json();
    const response = await fetch(`${CONFIG.voicevoxUrl}/synthesis?speaker=${selected}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'audio/wav' },
        body: JSON.stringify(query),
    });
    if (!response.ok) throw new Error(`voicevox synthesis ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
}

function toCsv(rows) {
    const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const output = [['hash', 'line', 'translation', 'reading', 'grammar', 'words', 'model', 'createdAt'].join(',')];
    for (const row of rows) {
        const analysis = row.analysis ?? {};
        output.push(
            [
                row.line_hash,
                row.line,
                analysis.translation ?? '',
                analysis.reading ?? '',
                (analysis.grammar ?? []).map((item) => item.pattern).join(' | '),
                (analysis.tokens ?? []).map((item) => item.surface).join(' '),
                row.model ?? '',
                row.created_at ?? '',
            ]
                .map(escape)
                .join(',')
        );
    }
    return output.join('\n');
}

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
    if (!CONFIG.publicDir) return false;
    const root = path.resolve(CONFIG.publicDir);
    const clean = decodeURIComponent(urlPath.split('?')[0]);
    const relative = path
        .normalize(clean)
        .replace(/^[/\\]+/, '')
        .replace(/^(\.\.[/\\])+/, '');
    let filePath = path.resolve(root, relative);
    if (!filePath.startsWith(root + path.sep) && filePath !== root) return false;
    let stat = await fs.stat(filePath).catch(() => null);
    if (stat?.isDirectory()) {
        filePath = path.join(filePath, 'index.html');
        stat = await fs.stat(filePath).catch(() => null);
    }
    if (!stat) {
        filePath = path.join(root, 'index.html');
        stat = await fs.stat(filePath).catch(() => null);
        if (!stat) return false;
    }
    const body = await fs.readFile(filePath);
    res.writeHead(200, {
        'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
        'Content-Length': body.length,
    });
    res.end(body);
    return true;
}

async function handleApi(req, res, url, route) {
    if (route === 'GET /api/health') {
        sendJson(res, 200, {
            ok: true,
            auth: true,
            users: database.userCount,
            lines: database.analysisCount,
            model: CONFIG.model,
            baseUrl: CONFIG.baseUrl,
        });
        return true;
    }
    if (route === 'POST /api/auth/login') {
        const body = await jsonBody(req);
        const user = database.getUserByUsername(body.username);
        if (!user || user.disabled || !(await verifyPassword(body.password, user.password_hash)))
            throw new HttpError(401, '用户名或密码错误');
        const session = issueSession(user.id);
        sendJson(res, 200, { user: publicUser(user) }, { 'Set-Cookie': cookieHeader(session.token, session.maxAge) });
        return true;
    }
    if (route === 'POST /api/auth/register') {
        const body = await jsonBody(req);
        const username = validateUsername(body.username);
        const password = validatePassword(body.password);
        if (!String(body.inviteCode ?? '').trim()) throw new HttpError(400, '请输入邀请码');
        try {
            const user = database.registerWithInvite({
                code: String(body.inviteCode).trim(),
                username,
                passwordHash: await hashPassword(password),
            });
            const session = issueSession(user.id);
            sendJson(
                res,
                201,
                { user: publicUser(user) },
                { 'Set-Cookie': cookieHeader(session.token, session.maxAge) }
            );
        } catch (error) {
            const message = String(error?.message ?? error);
            if (message.includes('UNIQUE')) throw new HttpError(409, '用户名已存在');
            throw new HttpError(400, message);
        }
        return true;
    }
    if (route === 'GET /api/auth/me') {
        sendJson(res, 200, { user: publicUser(requireUser(req)) });
        return true;
    }
    if (route === 'POST /api/auth/logout') {
        const token = sessionToken(req);
        if (token) database.deleteSession(sha256(token));
        sendJson(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader('', 0) });
        return true;
    }

    const user = requireUser(req);
    if (route === 'GET /api/account/api-key') {
        sendJson(res, 200, { configured: Boolean(user.encrypted_api_key) });
        return true;
    }
    if (route === 'PUT /api/account/api-key') {
        if (!CONFIG.encryptionSecret || CONFIG.encryptionSecret.length < 32)
            throw new HttpError(500, '服务器的 API_KEY_ENCRYPTION_SECRET 至少需要 32 个字符');
        const body = await jsonBody(req);
        const apiKey = String(body.apiKey ?? '').trim();
        if (apiKey.length < 8) throw new HttpError(400, 'API Key 格式无效');
        database.setApiKey(user.id, encryptSecret(apiKey, CONFIG.encryptionSecret));
        sendJson(res, 200, { configured: true });
        return true;
    }
    if (route === 'DELETE /api/account/api-key') {
        database.setApiKey(user.id, null);
        sendJson(res, 200, { configured: false });
        return true;
    }
    if (route === 'GET /api/spaces') {
        sendJson(res, 200, { spaces: database.listSpaces(user.id) });
        return true;
    }
    if (route === 'POST /api/spaces') {
        const body = await jsonBody(req);
        const name = String(body.name ?? '').trim();
        if (!name || name.length > 120) throw new HttpError(400, '番剧空间名称需要为 1–120 个字符');
        try {
            sendJson(res, 201, { space: database.createSpace(user.id, name) });
        } catch (error) {
            if (String(error?.message).includes('UNIQUE')) throw new HttpError(409, '同名番剧空间已存在');
            throw error;
        }
        return true;
    }
    if (route === 'POST /api/episodes') {
        const body = await jsonBody(req);
        const label = String(body.label ?? '').trim();
        if (!label || label.length > 80) throw new HttpError(400, '集数名称需要为 1–80 个字符');
        const episode = database.createOrUpdateEpisode(user.id, Number(body.spaceId), label, body.mediaFileName);
        sendJson(res, 200, { episode });
        return true;
    }
    if (route === 'GET /api/library') {
        sendJson(res, 200, { spaces: database.library(user.id) });
        return true;
    }
    if (route === 'GET /api/episode') {
        const episode = database.getEpisode(user.id, Number(url.searchParams.get('episodeId')));
        if (!episode) throw new HttpError(404, '未找到该集');
        sendJson(res, 200, episode);
        return true;
    }
    if (route === 'POST /api/analyze') {
        const body = await jsonBody(req);
        const line = String(body.line ?? '').trim();
        if (!line) throw new HttpError(400, '缺少 line');
        try {
            const result = await getOrCreateAnalysis(line, {
                force: Boolean(body.force),
                user,
                episodeId: body.episodeId ? Number(body.episodeId) : undefined,
            });
            sendJson(res, 200, result);
        } catch (error) {
            if (error instanceof HttpError) throw error;
            const message = error instanceof LlmAnalysisError ? error.message : String(error?.message || error);
            throw new HttpError(502, message);
        }
        return true;
    }
    if (route === 'GET /api/tts') {
        const text = url.searchParams.get('text') || '';
        if (!text.trim()) throw new HttpError(400, '缺少 text');
        try {
            const wav = await synthesizeVoicevox(text, url.searchParams.get('speaker') || '');
            res.writeHead(200, {
                'Content-Type': 'audio/wav',
                'Content-Length': wav.length,
                'Cache-Control': 'private, max-age=86400',
            });
            res.end(wav);
        } catch (error) {
            throw new HttpError(502, `VOICEVOX 不可用: ${String(error?.message || error)}`);
        }
        return true;
    }
    if (route === 'GET /api/stats') {
        sendJson(res, 200, database.stats(user.id));
        return true;
    }
    if (route === 'GET /api/export') {
        const rows = database.userRows(user.id);
        if ((url.searchParams.get('format') || 'jsonl') === 'csv') {
            const csv = toCsv(rows);
            res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8' });
            res.end(csv);
        } else {
            const jsonl = rows.map((row) => JSON.stringify(row)).join('\n');
            res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8' });
            res.end(jsonl);
        }
        return true;
    }
    if (route === 'GET /api/admin/invites') {
        requireAdmin(req);
        sendJson(res, 200, { invites: database.listInvites() });
        return true;
    }
    if (route === 'POST /api/admin/invites') {
        const admin = requireAdmin(req);
        const body = await jsonBody(req);
        const maxUses = Math.min(100, Math.max(1, Number(body.maxUses || 1)));
        const days = Math.min(365, Math.max(1, Number(body.expiresInDays || 7)));
        const code = randomToken(18);
        const invite = database.createInvite(
            admin.id,
            code,
            maxUses,
            new Date(Date.now() + days * 86400000).toISOString()
        );
        sendJson(res, 201, { invite });
        return true;
    }
    const disableInviteMatch = url.pathname.match(/^\/api\/admin\/invites\/(\d+)$/);
    if (req.method === 'DELETE' && disableInviteMatch) {
        requireAdmin(req);
        database.disableInvite(disableInviteMatch[1]);
        sendJson(res, 200, { ok: true });
        return true;
    }
    return false;
}

const server = http.createServer(async (req, res) => {
    try {
        const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        const route = `${req.method} ${url.pathname}`;
        if (url.pathname.startsWith('/api/')) {
            if (await handleApi(req, res, url, route)) return;
            sendJson(res, 404, { error: 'not found' });
            return;
        }
        if (req.method === 'GET' && (await serveStatic(req, res, url.pathname))) return;
        sendJson(res, 404, { error: 'not found' });
    } catch (error) {
        const status = error instanceof HttpError ? error.status : 500;
        if (status >= 500) console.error(error);
        sendJson(res, status, { error: String(error?.message || error) });
    }
});

function shutdown() {
    database.close();
    process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    server.listen(CONFIG.port, () => {
        console.log(`[asbplayer] listening on http://localhost:${CONFIG.port}`);
        console.log(`[asbplayer] model=${CONFIG.model} baseUrl=${CONFIG.baseUrl}`);
        console.log(
            `[asbplayer] database=${CONFIG.databasePath} users=${database.userCount} shared-lines=${database.analysisCount}`
        );
        if (CONFIG.publicDir) console.log(`[asbplayer] serving SPA from: ${CONFIG.publicDir}`);
    });
}

export { server, database, CONFIG, getOrCreateAnalysis };
