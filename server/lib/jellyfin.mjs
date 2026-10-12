import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { encryptSecret, decryptSecret } from './auth.mjs';

// Only the administrator-configured origin is contacted. Client requests cannot
// choose an upstream URL, forward arbitrary headers, or follow redirects.
export function createJellyfinHandler({ database, serverUrl, encryptionSecret, jsonBody, sendJson, HttpError }) {
    const base = serverUrl ? new URL(serverUrl.endsWith('/') ? serverUrl : `${serverUrl}/`) : undefined;
    if (
        base &&
        (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash)
    ) {
        throw new Error('JELLYFIN_URL must be an HTTP(S) server URL without credentials, query or fragment');
    }
    database.db.exec(`CREATE TABLE IF NOT EXISTS jellyfin_connections (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        server_url TEXT NOT NULL, jellyfin_user_id TEXT NOT NULL,
        username TEXT NOT NULL, encrypted_token TEXT NOT NULL
    )`);
    const connection = (userId) =>
        database.db
            .prepare('SELECT * FROM jellyfin_connections WHERE user_id = ? AND server_url = ?')
            .get(userId, base?.href ?? '');
    const id = (value) => {
        if (!/^[a-zA-Z0-9-]{1,128}$/.test(value ?? '')) throw new HttpError(400, '无效的媒体标识');
        return value;
    };
    function headers(userId, token) {
        return {
            Authorization: `MediaBrowser Client="asbplayer Study", Device="Study server", DeviceId="asbplayer-${userId}", Version="1.0"${token ? `, Token="${token}"` : ''}`,
        };
    }
    async function request(path, userId, token, options = {}) {
        try {
            const response = await fetch(new URL(path, base), {
                ...options,
                headers: { ...headers(userId, token), 'Accept-Encoding': 'identity', ...options.headers },
                redirect: 'error',
                signal: options.signal ?? AbortSignal.timeout(20000),
            });
            if (!response.ok && response.status !== 416) {
                await response.body?.cancel();
                const status = response.status;
                throw new HttpError(
                    status === 401 ? 409 : status === 403 || status === 404 ? status : 502,
                    status === 401
                        ? 'Jellyfin 登录已失效或账号密码不正确，请重新连接'
                        : status === 403
                          ? '此 Jellyfin 账号无权访问该媒体'
                          : status === 404
                            ? '媒体已不存在，请刷新媒体库'
                            : 'Jellyfin 暂时无法完成请求'
                );
            }
            return response;
        } catch (error) {
            if (error instanceof HttpError) throw error;
            throw new HttpError(502, '无法连接 Jellyfin，请检查服务器地址和网络');
        }
    }
    const itemView = (item) => ({
        id: item.Id,
        name: item.Name,
        type: item.Type,
        seriesName: item.SeriesName,
        season: item.ParentIndexNumber,
        episode: item.IndexNumber,
        year: item.ProductionYear,
        durationMs: item.RunTimeTicks ? item.RunTimeTicks / 10000 : undefined,
    });
    return async function handle(req, res, url, user) {
        if (!url.pathname.startsWith('/api/jellyfin/')) return false;
        const route = url.pathname.slice('/api/jellyfin/'.length);
        const saved = connection(user.id);
        if (route === 'connection' && req.method === 'GET') {
            sendJson(res, 200, {
                configured: Boolean(base && encryptionSecret),
                connected: Boolean(saved && encryptionSecret),
                username: saved?.username,
            });
            return true;
        }
        if (!base || !encryptionSecret)
            throw new HttpError(503, '管理员需要配置 JELLYFIN_URL 和 API_KEY_ENCRYPTION_SECRET');
        if (route === 'connection' && req.method === 'POST') {
            const body = await jsonBody(req);
            if (
                typeof body.username !== 'string' ||
                !body.username.trim() ||
                body.username.length > 200 ||
                typeof body.password !== 'string' ||
                body.password.length > 1000
            ) {
                throw new HttpError(400, '请填写有效的 Jellyfin 用户名和密码');
            }
            const auth = await (
                await request('Users/AuthenticateByName', user.id, undefined, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ Username: body.username, Pw: body.password }),
                })
            ).json();
            if (!auth.AccessToken || !auth.User?.Id || !/^[a-zA-Z0-9_-]+$/.test(auth.AccessToken))
                throw new HttpError(502, 'Jellyfin 返回了无效的登录信息');
            id(auth.User.Id);
            database.db
                .prepare(
                    `INSERT INTO jellyfin_connections VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET server_url=excluded.server_url, jellyfin_user_id=excluded.jellyfin_user_id,
                username=excluded.username, encrypted_token=excluded.encrypted_token`
                )
                .run(
                    user.id,
                    base.href,
                    auth.User.Id,
                    auth.User.Name ?? body.username,
                    encryptSecret(auth.AccessToken, encryptionSecret)
                );
            sendJson(res, 200, { connected: true, username: auth.User.Name ?? body.username });
            return true;
        }
        if (route === 'connection' && req.method === 'DELETE') {
            database.db.prepare('DELETE FROM jellyfin_connections WHERE user_id = ?').run(user.id);
            if (saved)
                await request('Sessions/Logout', user.id, decryptSecret(saved.encrypted_token, encryptionSecret), {
                    method: 'POST',
                }).catch(() => {});
            sendJson(res, 200, { connected: false });
            return true;
        }
        if (!saved) throw new HttpError(409, '请先连接 Jellyfin');
        const token = decryptSecret(saved.encrypted_token, encryptionSecret);
        const userPath = `Users/${id(saved.jellyfin_user_id)}`;
        if (route === 'items' && req.method === 'GET') {
            const parent = url.searchParams.get('parentId');
            const start = Number(url.searchParams.get('start') ?? 0);
            if (!Number.isSafeInteger(start) || start < 0) throw new HttpError(400, '无效的分页位置');
            const query = new URLSearchParams({
                UserId: saved.jellyfin_user_id,
                Limit: '50',
                StartIndex: String(start),
                Fields: 'SeriesName',
                SortBy: parent ? 'ParentIndexNumber,IndexNumber,SortName' : 'SortName',
                SortOrder: 'Ascending',
                Recursive: 'true',
                IncludeItemTypes: parent ? 'Episode' : 'Series,Movie',
            });
            if (parent) query.set('ParentId', id(parent));
            const search = url.searchParams.get('search')?.trim().slice(0, 200);
            if (search) query.set('SearchTerm', search);
            const result = await (await request(`${userPath}/Items?${query}`, user.id, token)).json();
            sendJson(res, 200, { items: (result.Items ?? []).map(itemView), total: result.TotalRecordCount ?? 0 });
            return true;
        }
        const match = route.match(/^(playback|stream|subtitles)\/([a-zA-Z0-9-]+)$/);
        if (!match || !['GET', 'HEAD'].includes(req.method)) throw new HttpError(404, '接口不存在');
        const [, action, itemId] = match;
        // Check item access with this user's identity before serving any bytes.
        const item = await (await request(`${userPath}/Items/${id(itemId)}`, user.id, token)).json();
        const info = await (
            await request(`Items/${itemId}/PlaybackInfo?UserId=${id(saved.jellyfin_user_id)}`, user.id, token)
        ).json();
        const sources = info.MediaSources ?? [];
        if (action === 'playback') {
            sendJson(res, 200, {
                item: itemView(item),
                sources: sources
                    .filter((s) => s.Id && !s.IsInfiniteStream && !s.RequiresOpening)
                    .map((source) => ({
                        id: source.Id,
                        name: source.Name,
                        container: source.Container,
                        videoCodec: source.MediaStreams?.find((s) => s.Type === 'Video')?.Codec,
                        audioCodec: source.MediaStreams?.find(
                            (s) =>
                                s.Type === 'Audio' &&
                                (source.DefaultAudioStreamIndex == null || s.Index === source.DefaultAudioStreamIndex)
                        )?.Codec,
                        subtitles: (source.MediaStreams ?? [])
                            .filter((s) => s.Type === 'Subtitle' && s.IsTextSubtitleStream)
                            .map((s) => ({
                                index: s.Index,
                                label: s.DisplayTitle ?? s.Language ?? `字幕 ${s.Index}`,
                                language: s.Language,
                            })),
                    })),
            });
            return true;
        }
        const sourceId = id(url.searchParams.get('sourceId'));
        const source = sources.find((s) => s.Id === sourceId && !s.IsInfiniteStream && !s.RequiresOpening);
        if (!source) throw new HttpError(404, '此视频版本不可用');
        let upstream;
        if (action === 'subtitles') {
            const index = Number(url.searchParams.get('index'));
            if (
                !Number.isSafeInteger(index) ||
                !source.MediaStreams?.some((s) => s.Type === 'Subtitle' && s.IsTextSubtitleStream && s.Index === index)
            )
                throw new HttpError(400, '请选择可读取的文本字幕');
            upstream = `Videos/${itemId}/${sourceId}/Subtitles/${index}/0/Stream.srt`;
        } else {
            upstream = `Videos/${itemId}/stream?${new URLSearchParams({ Static: 'true', MediaSourceId: sourceId })}`;
        }
        const controller = new AbortController();
        const cancel = () => controller.abort();
        res.once('close', cancel);
        // A deadline for receiving headers, without cutting off a long movie.
        const timeout = setTimeout(cancel, 20000);
        try {
            const response = await request(upstream, user.id, token, {
                method: req.method,
                signal: controller.signal,
                headers: req.headers.range && action === 'stream' ? { Range: req.headers.range } : {},
            });
            clearTimeout(timeout);
            const out = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
            for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
                if (response.headers.has(name)) out[name] = response.headers.get(name);
            }
            res.writeHead(response.status, out);
            if (req.method === 'HEAD' || !response.body) res.end();
            else await pipeline(Readable.fromWeb(response.body), res);
        } finally {
            clearTimeout(timeout);
            res.off('close', cancel);
        }
        return true;
    };
}
