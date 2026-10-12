import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { once } from 'node:events';
import { decryptSecret } from './lib/auth.mjs';

test('Jellyfin integration: authenticated library, private credentials, Range streaming and text subtitles', async (t) => {
    const calls = [];
    const media = Buffer.from('0123456789');
    let redirected = false;
    const upstream = http.createServer(async (req, res) => {
        calls.push({ url: req.url, headers: req.headers });
        const url = new URL(req.url, 'http://localhost');
        const json = (value) => {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(value));
        };
        if (url.pathname === '/jellyfin/Users/AuthenticateByName') {
            let body = '';
            for await (const chunk of req) body += chunk;
            if (JSON.parse(body).Pw !== 'jelly-password') {
                res.writeHead(401);
                res.end('secret upstream diagnostic');
                return;
            }
            return json({ AccessToken: 'private-jellyfin-token', User: { Id: 'jf-user', Name: 'learner' } });
        }
        if (!req.headers.authorization?.includes('Token="private-jellyfin-token"')) {
            res.writeHead(401);
            res.end();
            return;
        }
        if (url.pathname === '/jellyfin/Sessions/Logout') {
            res.writeHead(204);
            res.end();
            return;
        }
        if (url.pathname === '/jellyfin/Users/jf-user/Items')
            return json({
                Items: [{ Id: 'series', Type: 'Series', Name: 'Test series', Path: '/private/path' }],
                TotalRecordCount: 1,
            });
        if (url.pathname === '/jellyfin/Users/jf-user/Items/forbidden') {
            res.writeHead(403);
            res.end();
            return;
        }
        if (url.pathname === '/jellyfin/Users/jf-user/Items/episode')
            return json({ Id: 'episode', Name: 'First episode', Type: 'Episode' });
        if (url.pathname === '/jellyfin/Items/episode/PlaybackInfo')
            return json({
                MediaSources: [
                    {
                        Id: 'source',
                        Container: 'mp4',
                        Path: '/private/video',
                        MediaStreams: [
                            { Type: 'Video', Codec: 'h264', Index: 0 },
                            { Type: 'Audio', Codec: 'aac', Index: 1 },
                            { Type: 'Subtitle', Index: 2, Language: 'jpn', IsTextSubtitleStream: true },
                            { Type: 'Subtitle', Index: 3, IsTextSubtitleStream: false, Codec: 'pgssub' },
                        ],
                    },
                ],
            });
        if (url.pathname === '/jellyfin/Videos/episode/source/Subtitles/2/0/Stream.srt') {
            res.setHeader('Content-Type', 'text/plain');
            res.end('1\n00:00:01,000 --> 00:00:02,000\nこんにちは\n');
            return;
        }
        if (url.pathname === '/jellyfin/Videos/episode/stream') {
            if (redirected) {
                res.writeHead(302, { Location: 'http://127.0.0.1:1/private' });
                res.end();
                return;
            }
            assert.equal(url.searchParams.get('Static'), 'true');
            assert.equal(url.searchParams.get('MediaSourceId'), 'source');
            res.setHeader('Accept-Ranges', 'bytes');
            res.setHeader('Content-Type', 'video/mp4');
            let body = media;
            if (req.headers.range) {
                if (req.headers.range === 'bytes=99-') {
                    res.writeHead(416, { 'Content-Range': 'bytes */10' });
                    res.end();
                    return;
                }
                assert.equal(req.headers.range, 'bytes=2-5');
                body = media.subarray(2, 6);
                res.statusCode = 206;
                res.setHeader('Content-Range', 'bytes 2-5/10');
            }
            res.setHeader('Content-Length', body.length);
            res.end(req.method === 'HEAD' ? undefined : body);
            return;
        }
        res.writeHead(404);
        res.end();
    });
    upstream.listen(0, '127.0.0.1');
    await once(upstream, 'listening');
    const dir = await mkdtemp(path.join(os.tmpdir(), 'asb-jellyfin-test-'));
    Object.assign(process.env, {
        DATA_DIR: dir,
        DATABASE_PATH: path.join(dir, 'test.sqlite'),
        ADMIN_USERNAME: 'testadmin',
        ADMIN_PASSWORD: 'test-password-123',
        API_KEY_ENCRYPTION_SECRET: 'test-only-encryption-secret-32-characters',
        JELLYFIN_URL: `http://127.0.0.1:${upstream.address().port}/jellyfin`,
        SECURE_COOKIES: 'false',
        PUBLIC_DIR: '',
    });
    const { server, database } = await import('./server.mjs');
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    t.after(async () => {
        server.closeAllConnections();
        upstream.closeAllConnections();
        await Promise.all([
            new Promise((resolve) => server.close(resolve)),
            new Promise((resolve) => upstream.close(resolve)),
        ]);
        database.close();
        await rm(dir, { recursive: true, force: true });
    });
    const login = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'testadmin', password: 'test-password-123' }),
    });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const api = (route, init = {}) =>
        fetch(`${base}/api/jellyfin/${route}`, {
            ...init,
            headers: { Cookie: cookie, 'Content-Type': 'application/json', ...init.headers },
        });
    await t.test('requires app authentication and a per-user Jellyfin connection', async () => {
        assert.equal((await fetch(`${base}/api/jellyfin/items`)).status, 401);
        assert.equal((await api('items')).status, 409);
        const status = await (await api('connection')).json();
        assert.deepEqual(status, { configured: true, connected: false });
    });
    await t.test('does not expose upstream diagnostics or save passwords', async () => {
        const failure = await api('connection', {
            method: 'POST',
            body: JSON.stringify({ username: 'learner', password: 'wrong' }),
        });
        assert.equal(failure.status, 409);
        assert.ok(!(await failure.text()).includes('secret upstream diagnostic'));
        const connected = await api('connection', {
            method: 'POST',
            body: JSON.stringify({ username: 'learner', password: 'jelly-password' }),
        });
        assert.equal(connected.status, 200);
        assert.ok(!(await connected.text()).includes('private-jellyfin-token'));
        const saved = database.db.prepare('SELECT * FROM jellyfin_connections').get();
        assert.ok(!JSON.stringify(saved).includes('private-jellyfin-token'));
        assert.ok(!JSON.stringify(saved).includes('jelly-password'));
        assert.equal(
            decryptSecret(saved.encrypted_token, process.env.API_KEY_ENCRYPTION_SECRET),
            'private-jellyfin-token'
        );
    });
    await t.test('connection is isolated from another application account', async () => {
        await fetch(`${base}/api/admin/users`, {
            method: 'POST',
            headers: { Cookie: cookie, 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'second-user', password: 'test-password-456' }),
        });
        const response = await fetch(`${base}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'second-user', password: 'test-password-456' }),
        });
        const secondCookie = response.headers.get('set-cookie').split(';')[0];
        const status = await fetch(`${base}/api/jellyfin/connection`, { headers: { Cookie: secondCookie } });
        assert.equal((await status.json()).connected, false);
        assert.equal(
            (await fetch(`${base}/api/jellyfin/stream/episode?sourceId=source`, { headers: { Cookie: secondCookie } }))
                .status,
            409
        );
    });
    await t.test('uses server base path and user-scoped listing with pagination', async () => {
        const response = await api('items?parentId=series&start=50&search=hello');
        assert.equal(response.status, 200);
        const text = await response.text();
        assert.ok(!text.includes('/private/path'));
        const url = new URL(calls.at(-1).url, base);
        assert.equal(url.searchParams.get('ParentId'), 'series');
        assert.equal(url.searchParams.get('StartIndex'), '50');
        assert.equal(url.searchParams.get('SearchTerm'), 'hello');
        assert.equal((await api('items?parentId=..%2Fprivate')).status, 400);
    });
    await t.test('only exposes extractable subtitles and rejects mismatched sources', async () => {
        const playback = await (await api('playback/episode')).json();
        assert.equal(playback.sources[0].subtitles.length, 1);
        assert.ok(!JSON.stringify(playback).includes('/private/video'));
        assert.equal((await api('stream/episode?sourceId=other')).status, 404);
        assert.equal((await api('subtitles/episode?sourceId=source&index=3')).status, 400);
        const subtitles = await api('subtitles/episode?sourceId=source&index=2');
        assert.match(await subtitles.text(), /こんにちは/);
        assert.equal((await api('stream/forbidden?sourceId=source')).status, 403);
    });
    await t.test('preserves byte ranges, HEAD and unsatisfiable-range responses', async () => {
        const range = await api('stream/episode?sourceId=source', { headers: { Range: 'bytes=2-5' } });
        assert.equal(range.status, 206);
        assert.equal(range.headers.get('content-range'), 'bytes 2-5/10');
        assert.equal(range.headers.get('cache-control'), 'private, no-store');
        assert.equal(await range.text(), '2345');
        const head = await api('stream/episode?sourceId=source', { method: 'HEAD' });
        assert.equal(head.headers.get('content-length'), '10');
        assert.equal(await head.text(), '');
        const unsatisfiable = await api('stream/episode?sourceId=source', { headers: { Range: 'bytes=99-' } });
        assert.equal(unsatisfiable.status, 416);
        assert.equal(unsatisfiable.headers.get('content-range'), 'bytes */10');
    });
    await t.test('never follows stream redirects or forwards application cookies', async () => {
        redirected = true;
        assert.equal((await api('stream/episode?sourceId=source')).status, 502);
        assert.ok(calls.every((call) => !call.headers.cookie));
    });
    await t.test('disconnect removes credentials and blocks further playback', async () => {
        assert.equal((await api('connection', { method: 'DELETE' })).status, 200);
        assert.equal(database.db.prepare('SELECT COUNT(*) AS count FROM jellyfin_connections').get().count, 0);
        assert.equal((await api('stream/episode?sourceId=source')).status, 409);
    });
});
