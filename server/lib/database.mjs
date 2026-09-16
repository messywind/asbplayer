import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { hashLine } from './store.mjs';
import { normalizeLine } from './llm.mjs';
import { sha256 } from './auth.mjs';

function now() {
    return new Date().toISOString();
}

function parseAnalysis(row) {
    if (!row) return undefined;
    return { ...row, analysis: JSON.parse(row.analysis_json) };
}

export class MultiUserDatabase {
    constructor(filename) {
        if (filename !== ':memory:') mkdirSync(path.dirname(filename), { recursive: true });
        this.filename = filename;
        this.db = new DatabaseSync(filename);
        this.db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
        this.initSchema();
    }

    initSchema() {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL COLLATE NOCASE UNIQUE,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
                encrypted_api_key TEXT,
                disabled INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS invites (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                code_hash TEXT NOT NULL UNIQUE,
                created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                max_uses INTEGER NOT NULL DEFAULT 1,
                uses INTEGER NOT NULL DEFAULT 0,
                expires_at TEXT,
                disabled INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS anime_spaces (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                name TEXT NOT NULL COLLATE NOCASE,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(user_id, name)
            );
            CREATE TABLE IF NOT EXISTS episodes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                space_id INTEGER NOT NULL REFERENCES anime_spaces(id) ON DELETE CASCADE,
                label TEXT NOT NULL COLLATE NOCASE,
                media_file_name TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(space_id, label)
            );
            CREATE TABLE IF NOT EXISTS analyses (
                line_hash TEXT PRIMARY KEY,
                line TEXT NOT NULL,
                analysis_json TEXT NOT NULL,
                model TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS episode_analyses (
                episode_id INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
                line_hash TEXT NOT NULL REFERENCES analyses(line_hash) ON DELETE CASCADE,
                created_at TEXT NOT NULL,
                PRIMARY KEY(episode_id, line_hash)
            );
            CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
            CREATE INDEX IF NOT EXISTS idx_episodes_space ON episodes(space_id);
            CREATE INDEX IF NOT EXISTS idx_episode_analyses_hash ON episode_analyses(line_hash);
        `);
    }

    close() {
        this.db.close();
    }

    get analysisCount() {
        return Number(this.db.prepare('SELECT COUNT(*) AS count FROM analyses').get().count);
    }

    get userCount() {
        return Number(this.db.prepare('SELECT COUNT(*) AS count FROM users').get().count);
    }

    getUserByUsername(username) {
        return this.db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(String(username).trim());
    }

    getUserById(id) {
        return this.db.prepare('SELECT * FROM users WHERE id = ?').get(Number(id));
    }

    createUser(username, passwordHash, role = 'user') {
        const result = this.db
            .prepare('INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)')
            .run(String(username).trim(), passwordHash, role, now());
        return this.getUserById(result.lastInsertRowid);
    }

    setApiKey(userId, encryptedApiKey) {
        this.db
            .prepare('UPDATE users SET encrypted_api_key = ? WHERE id = ?')
            .run(encryptedApiKey || null, Number(userId));
    }

    createSession(userId, tokenHash, expiresAt) {
        this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now());
        this.db
            .prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
            .run(tokenHash, Number(userId), expiresAt, now());
    }

    deleteSession(tokenHash) {
        this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    }

    userForSession(tokenHash) {
        return this.db
            .prepare(
                `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
                 WHERE s.token_hash = ? AND s.expires_at > ? AND u.disabled = 0`
            )
            .get(tokenHash, now());
    }

    createInvite(createdBy, code, maxUses, expiresAt) {
        const createdAt = now();
        const result = this.db
            .prepare(
                `INSERT INTO invites (code_hash, created_by, max_uses, expires_at, created_at)
                 VALUES (?, ?, ?, ?, ?)`
            )
            .run(sha256(code), Number(createdBy), Number(maxUses), expiresAt || null, createdAt);
        return { id: Number(result.lastInsertRowid), code, maxUses: Number(maxUses), uses: 0, expiresAt, createdAt };
    }

    listInvites() {
        return this.db
            .prepare(
                `SELECT i.id, i.max_uses AS maxUses, i.uses, i.expires_at AS expiresAt,
                        i.disabled, i.created_at AS createdAt, u.username AS createdBy
                 FROM invites i JOIN users u ON u.id = i.created_by
                 ORDER BY i.id DESC LIMIT 100`
            )
            .all();
    }

    disableInvite(id) {
        this.db.prepare('UPDATE invites SET disabled = 1 WHERE id = ?').run(Number(id));
    }

    registerWithInvite({ code, username, passwordHash }) {
        this.db.exec('BEGIN IMMEDIATE');
        try {
            const invite = this.db.prepare('SELECT * FROM invites WHERE code_hash = ?').get(sha256(code));
            if (!invite || invite.disabled || invite.uses >= invite.max_uses) throw new Error('邀请码无效或已用完');
            if (invite.expires_at && invite.expires_at <= now()) throw new Error('邀请码已过期');
            const user = this.createUser(username, passwordHash, 'user');
            this.db.prepare('UPDATE invites SET uses = uses + 1 WHERE id = ?').run(invite.id);
            this.db.exec('COMMIT');
            return user;
        } catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
    }

    createSpace(userId, name) {
        const timestamp = now();
        const result = this.db
            .prepare('INSERT INTO anime_spaces (user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
            .run(Number(userId), String(name).trim(), timestamp, timestamp);
        return this.getSpace(userId, result.lastInsertRowid);
    }

    getSpace(userId, id) {
        return this.db
            .prepare(
                'SELECT id, name, created_at AS createdAt, updated_at AS updatedAt FROM anime_spaces WHERE id = ? AND user_id = ?'
            )
            .get(Number(id), Number(userId));
    }

    listSpaces(userId) {
        return this.db
            .prepare(
                `SELECT s.id, s.name, s.created_at AS createdAt, s.updated_at AS updatedAt,
                        COUNT(DISTINCT e.id) AS episodeCount,
                        COUNT(ea.line_hash) AS analysisCount
                 FROM anime_spaces s
                 LEFT JOIN episodes e ON e.space_id = s.id
                 LEFT JOIN episode_analyses ea ON ea.episode_id = e.id
                 WHERE s.user_id = ?
                 GROUP BY s.id
                 ORDER BY s.updated_at DESC, s.name COLLATE NOCASE`
            )
            .all(Number(userId));
    }

    createOrUpdateEpisode(userId, spaceId, label, mediaFileName) {
        const space = this.getSpace(userId, spaceId);
        if (!space) throw new Error('番剧空间不存在');
        const timestamp = now();
        this.db
            .prepare(
                `INSERT INTO episodes (space_id, label, media_file_name, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?)
                 ON CONFLICT(space_id, label) DO UPDATE SET
                    media_file_name = excluded.media_file_name,
                    updated_at = excluded.updated_at`
            )
            .run(Number(spaceId), String(label).trim(), mediaFileName || null, timestamp, timestamp);
        this.db.prepare('UPDATE anime_spaces SET updated_at = ? WHERE id = ?').run(timestamp, Number(spaceId));
        return this.db
            .prepare(
                `SELECT e.id, e.label, e.media_file_name AS mediaFileName, e.created_at AS createdAt,
                        e.updated_at AS updatedAt, s.id AS spaceId, s.name AS spaceName
                 FROM episodes e JOIN anime_spaces s ON s.id = e.space_id
                 WHERE e.space_id = ? AND e.label = ? COLLATE NOCASE AND s.user_id = ?`
            )
            .get(Number(spaceId), String(label).trim(), Number(userId));
    }

    episodeOwnedBy(userId, episodeId) {
        return this.db
            .prepare(
                `SELECT e.id, e.label, e.media_file_name AS mediaFileName, s.id AS spaceId, s.name AS spaceName
                 FROM episodes e JOIN anime_spaces s ON s.id = e.space_id
                 WHERE e.id = ? AND s.user_id = ?`
            )
            .get(Number(episodeId), Number(userId));
    }

    library(userId) {
        const spaces = this.listSpaces(userId);
        const episodes = this.db
            .prepare(
                `SELECT e.id, e.space_id AS spaceId, e.label, e.media_file_name AS mediaFileName,
                        e.updated_at AS updatedAt, COUNT(ea.line_hash) AS analysisCount
                 FROM episodes e
                 JOIN anime_spaces s ON s.id = e.space_id
                 LEFT JOIN episode_analyses ea ON ea.episode_id = e.id
                 WHERE s.user_id = ?
                 GROUP BY e.id
                 ORDER BY e.label COLLATE NOCASE`
            )
            .all(Number(userId));
        return spaces.map((space) => ({
            ...space,
            episodes: episodes.filter((episode) => episode.spaceId === space.id),
        }));
    }

    getAnalysis(line) {
        return parseAnalysis(this.db.prepare('SELECT * FROM analyses WHERE line_hash = ?').get(hashLine(line)));
    }

    putAnalysis(line, analysis, model) {
        const hash = hashLine(line);
        const timestamp = now();
        this.db
            .prepare(
                `INSERT INTO analyses (line_hash, line, analysis_json, model, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?)
                 ON CONFLICT(line_hash) DO UPDATE SET
                    analysis_json = excluded.analysis_json,
                    model = excluded.model,
                    updated_at = excluded.updated_at`
            )
            .run(hash, normalizeLine(line), JSON.stringify(analysis), model || null, timestamp, timestamp);
        return this.getAnalysis(line);
    }

    associateAnalysis(userId, episodeId, line) {
        if (!episodeId) return;
        if (!this.episodeOwnedBy(userId, episodeId)) throw new Error('无权访问该集');
        this.db
            .prepare('INSERT OR IGNORE INTO episode_analyses (episode_id, line_hash, created_at) VALUES (?, ?, ?)')
            .run(Number(episodeId), hashLine(line), now());
    }

    getEpisode(userId, episodeId) {
        const episode = this.episodeOwnedBy(userId, episodeId);
        if (!episode) return undefined;
        const rows = this.db
            .prepare(
                `SELECT a.* FROM episode_analyses ea
                 JOIN analyses a ON a.line_hash = ea.line_hash
                 WHERE ea.episode_id = ? ORDER BY ea.created_at, a.line`
            )
            .all(Number(episodeId));
        const analyses = {};
        for (const row of rows) analyses[row.line] = JSON.parse(row.analysis_json);
        return { ...episode, count: rows.length, analyses };
    }

    userRows(userId) {
        return this.db
            .prepare(
                `SELECT DISTINCT a.* FROM analyses a
                 JOIN episode_analyses ea ON ea.line_hash = a.line_hash
                 JOIN episodes e ON e.id = ea.episode_id
                 JOIN anime_spaces s ON s.id = e.space_id
                 WHERE s.user_id = ? ORDER BY a.created_at`
            )
            .all(Number(userId))
            .map(parseAnalysis);
    }

    stats(userId) {
        const rows = this.userRows(userId);
        const library = this.library(userId);
        const grammar = new Map();
        const words = new Map();
        const byLevel = {};
        let tokenTotal = 0;
        let grammarTotal = 0;
        for (const row of rows) {
            for (const item of row.analysis?.grammar ?? []) {
                grammarTotal++;
                if (item.pattern) grammar.set(item.pattern, (grammar.get(item.pattern) ?? 0) + 1);
                if (item.level) byLevel[item.level] = (byLevel[item.level] ?? 0) + 1;
            }
            for (const token of row.analysis?.tokens ?? []) {
                tokenTotal++;
                const key = token.lemma || token.surface;
                if (key) words.set(key, (words.get(key) ?? 0) + 1);
            }
        }
        const top = (map, count) =>
            [...map.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, count)
                .map(([key, value]) => ({ key, count: value }));
        return {
            lines: rows.length,
            shows: library.length,
            episodes: library.reduce((sum, space) => sum + space.episodes.length, 0),
            tokenTotal,
            grammarTotal,
            uniqueGrammar: grammar.size,
            uniqueLemma: words.size,
            byLevel,
            topGrammar: top(grammar, 30),
            topWords: top(words, 50),
        };
    }
}
