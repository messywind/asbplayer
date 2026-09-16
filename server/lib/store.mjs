// File-backed analysis cache + simple stats, zero dependencies.
//
// On-disk layout (human-browsable, organized by show then episode):
//
//   DATA_DIR/<anime>/<episode>.json   — { anime, episode, updatedAt, lines: { [hash]: Record } }
//   DATA_DIR/analyses.jsonl           — append log, one Record per line (for jq / pandas / AI stats)
//
// Record = { hash, line, analysis, model, anime, episode, createdAt }
//   line     = normalized subtitle text (the analysis subject)
//   analysis = SubtitleAnalysis (translation/reading/tokens/grammar/notes)
//
// In memory we also keep a single global Map<hash, Record> so that:
//   - the same line is never analyzed (paid for) twice, even across episodes;
//   - /api/stats and /api/export can aggregate over everything at once.
// The global index is derived from the per-episode files, so those files remain
// the single source of truth on disk.

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { normalizeLine } from './llm.mjs';

export function hashLine(line) {
    return createHash('sha256').update(normalizeLine(line), 'utf8').digest('hex');
}

const DEFAULT_ANIME = '_misc';
const DEFAULT_EPISODE = '_';
const KEY_SEP = '\u0000';

/** Make a string safe to use as a single path segment (folder / file name). */
export function sanitizeSegment(s) {
    const t = String(s ?? '')
        .trim()
        .replace(/[\\/:*?"<>|]/g, '_') // path-illegal chars
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001f]/g, '') // control chars
        .replace(/\s+/g, ' ')
        .replace(/\.+$/, '') // no trailing dots (Windows)
        .slice(0, 120);
    return t || '_';
}

export class AnalysisStore {
    constructor(dataDir) {
        this.dataDir = dataDir;
        this.jsonlPath = path.join(dataDir, 'analyses.jsonl');
        this.legacyJsonPath = path.join(dataDir, 'analyses.json');
        /** hash -> Record (global dedup index / stats source) @type {Map<string, object>} */
        this.map = new Map();
        /** epKey -> { anime, episode, safeAnime, safeEpisode, updatedAt, lines } @type {Map<string, object>} */
        this.episodes = new Map();
        this._dirty = new Set();
        this._flushTimer = undefined;
        this._flushing = Promise.resolve();
    }

    _epKey(safeAnime, safeEpisode) {
        return `${safeAnime}${KEY_SEP}${safeEpisode}`;
    }

    async init() {
        await fs.mkdir(this.dataDir, { recursive: true });

        // Load every per-episode file: DATA_DIR/<anime>/<episode>.json
        let animeDirs = [];
        try {
            animeDirs = await fs.readdir(this.dataDir, { withFileTypes: true });
        } catch {
            /* empty */
        }
        for (const dirent of animeDirs) {
            if (!dirent.isDirectory()) {
                continue;
            }
            const safeAnime = dirent.name;
            const animePath = path.join(this.dataDir, safeAnime);
            let files = [];
            try {
                files = await fs.readdir(animePath);
            } catch {
                continue;
            }
            for (const f of files) {
                if (!f.endsWith('.json')) {
                    continue;
                }
                const safeEpisode = f.slice(0, -'.json'.length);
                try {
                    const text = await fs.readFile(path.join(animePath, f), 'utf8');
                    const data = JSON.parse(text);
                    const lines = data.lines ?? {};
                    const entry = {
                        anime: data.anime ?? safeAnime,
                        episode: data.episode ?? safeEpisode,
                        safeAnime,
                        safeEpisode,
                        updatedAt: data.updatedAt,
                        lines,
                    };
                    this.episodes.set(this._epKey(safeAnime, safeEpisode), entry);
                    for (const [hash, rec] of Object.entries(lines)) {
                        this.map.set(hash, rec);
                    }
                } catch {
                    /* skip corrupt file */
                }
            }
        }

        // One-time continuity: fold a legacy flat analyses.json into the index.
        try {
            const text = await fs.readFile(this.legacyJsonPath, 'utf8');
            const obj = JSON.parse(text);
            for (const [hash, rec] of Object.entries(obj)) {
                if (!this.map.has(hash)) {
                    this.map.set(hash, rec);
                    const safeAnime = sanitizeSegment(rec.anime || DEFAULT_ANIME);
                    const safeEpisode = sanitizeSegment(rec.episode || DEFAULT_EPISODE);
                    this._episodeEntry(rec.anime || DEFAULT_ANIME, rec.episode || DEFAULT_EPISODE, safeAnime, safeEpisode).lines[
                        hash
                    ] = rec;
                    this._dirty.add(this._epKey(safeAnime, safeEpisode));
                }
            }
            if (this._dirty.size > 0) {
                await this.flush(); // migrate into per-episode files
            }
        } catch {
            /* no legacy file */
        }

        return this;
    }

    _episodeEntry(anime, episode, safeAnime, safeEpisode) {
        const key = this._epKey(safeAnime, safeEpisode);
        let entry = this.episodes.get(key);
        if (!entry) {
            entry = { anime, episode, safeAnime, safeEpisode, updatedAt: undefined, lines: {} };
            this.episodes.set(key, entry);
        }
        return entry;
    }

    get size() {
        return this.map.size;
    }

    get(line) {
        return this.map.get(hashLine(line));
    }

    has(line) {
        return this.map.has(hashLine(line));
    }

    async put(line, analysis, model, anime = DEFAULT_ANIME, episode = DEFAULT_EPISODE) {
        const hash = hashLine(line);
        const safeAnime = sanitizeSegment(anime || DEFAULT_ANIME);
        const safeEpisode = sanitizeSegment(episode || DEFAULT_EPISODE);
        const record = {
            hash,
            line: normalizeLine(line),
            analysis,
            model: model ?? null,
            anime: anime || DEFAULT_ANIME,
            episode: episode || DEFAULT_EPISODE,
            createdAt: new Date().toISOString(),
        };
        this.map.set(hash, record);
        const entry = this._episodeEntry(record.anime, record.episode, safeAnime, safeEpisode);
        entry.lines[hash] = record;
        entry.updatedAt = record.createdAt;
        this._dirty.add(this._epKey(safeAnime, safeEpisode));

        // Append to the event log immediately (cheap, crash-safe-ish).
        try {
            await fs.appendFile(this.jsonlPath, JSON.stringify(record) + '\n', 'utf8');
        } catch {
            /* non-fatal: per-episode json is the source of truth */
        }
        this._scheduleFlush();
        return record;
    }

    /** All cached analyses for one episode: { normalizedLine: analysis }. */
    getEpisode(anime, episode) {
        const safeAnime = sanitizeSegment(anime || DEFAULT_ANIME);
        const safeEpisode = sanitizeSegment(episode || DEFAULT_EPISODE);
        const entry = this.episodes.get(this._epKey(safeAnime, safeEpisode));
        const analyses = {};
        if (entry) {
            for (const rec of Object.values(entry.lines)) {
                analyses[rec.line] = rec.analysis;
            }
        }
        return { anime: entry?.anime ?? anime, episode: entry?.episode ?? episode, count: Object.keys(analyses).length, analyses };
    }

    /** Whether a given episode file already contains this line. */
    episodeHas(anime, episode, line) {
        const safeAnime = sanitizeSegment(anime || DEFAULT_ANIME);
        const safeEpisode = sanitizeSegment(episode || DEFAULT_EPISODE);
        const entry = this.episodes.get(this._epKey(safeAnime, safeEpisode));
        return Boolean(entry && entry.lines[hashLine(line)]);
    }

    /** Listing of shows and episodes on disk (for browsing / stats UIs). */
    library() {
        const shows = new Map();
        for (const entry of this.episodes.values()) {
            if (!shows.has(entry.anime)) {
                shows.set(entry.anime, []);
            }
            shows.get(entry.anime).push({ episode: entry.episode, lines: Object.keys(entry.lines).length });
        }
        return [...shows.entries()].map(([anime, episodes]) => ({
            anime,
            episodes: episodes.sort((a, b) => String(a.episode).localeCompare(String(b.episode), undefined, { numeric: true })),
        }));
    }

    _scheduleFlush() {
        if (this._flushTimer) {
            return;
        }
        this._flushTimer = setTimeout(() => {
            this._flushTimer = undefined;
            this._flushing = this.flush();
        }, 500);
        if (typeof this._flushTimer.unref === 'function') {
            this._flushTimer.unref();
        }
    }

    async flush() {
        const dirty = [...this._dirty];
        this._dirty.clear();
        for (const key of dirty) {
            const entry = this.episodes.get(key);
            if (!entry) {
                continue;
            }
            const dir = path.join(this.dataDir, entry.safeAnime);
            await fs.mkdir(dir, { recursive: true });
            const filePath = path.join(dir, `${entry.safeEpisode}.json`);
            const payload = {
                anime: entry.anime,
                episode: entry.episode,
                updatedAt: entry.updatedAt,
                lines: entry.lines,
            };
            const tmp = filePath + '.tmp';
            await fs.writeFile(tmp, JSON.stringify(payload, null, 0), 'utf8');
            await fs.rename(tmp, filePath); // atomic replace, no unlink needed
        }
    }

    /** Flush any pending write and wait for it (call on shutdown). */
    async close() {
        if (this._flushTimer) {
            clearTimeout(this._flushTimer);
            this._flushTimer = undefined;
        }
        await this._flushing;
        await this.flush();
    }

    /** Aggregate statistics over everything analyzed so far. */
    stats() {
        const byModel = {};
        const byLevel = {};
        const byShow = {};
        const grammarFreq = new Map();
        const lemmaFreq = new Map();
        let tokenTotal = 0;
        let grammarTotal = 0;

        for (const rec of this.map.values()) {
            byModel[rec.model ?? 'unknown'] = (byModel[rec.model ?? 'unknown'] ?? 0) + 1;
            if (rec.anime) {
                byShow[rec.anime] = (byShow[rec.anime] ?? 0) + 1;
            }
            const a = rec.analysis ?? {};
            for (const g of a.grammar ?? []) {
                grammarTotal++;
                if (g.level) {
                    byLevel[g.level] = (byLevel[g.level] ?? 0) + 1;
                }
                if (g.pattern) {
                    grammarFreq.set(g.pattern, (grammarFreq.get(g.pattern) ?? 0) + 1);
                }
            }
            for (const tk of a.tokens ?? []) {
                tokenTotal++;
                const key = tk.lemma || tk.surface;
                if (key) {
                    lemmaFreq.set(key, (lemmaFreq.get(key) ?? 0) + 1);
                }
            }
        }

        const top = (m, n) =>
            [...m.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, n)
                .map(([key, count]) => ({ key, count }));

        return {
            lines: this.map.size,
            episodes: this.episodes.size,
            shows: Object.keys(byShow).length,
            tokenTotal,
            grammarTotal,
            uniqueGrammar: grammarFreq.size,
            uniqueLemma: lemmaFreq.size,
            byModel,
            byLevel,
            byShow,
            topGrammar: top(grammarFreq, 30),
            topWords: top(lemmaFreq, 50),
        };
    }

    /** Rows for export as JSONL or CSV. */
    exportRows() {
        return [...this.map.values()];
    }
}
