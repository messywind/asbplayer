// File-backed analysis cache + simple stats, zero dependencies.
//
// Canonical store: DATA_DIR/analyses.json  — { [hash]: Record } (deduped)
// Append log:      DATA_DIR/analyses.jsonl — one Record per line (for external
//                  / AI statistical analysis; easy to stream with jq / pandas)
//
// Record = { hash, line, analysis, model, createdAt }
//   line     = normalized subtitle text (the analysis subject)
//   analysis = SubtitleAnalysis (translation/reading/tokens/grammar/notes)

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { normalizeLine } from './llm.mjs';

export function hashLine(line) {
    return createHash('sha256').update(normalizeLine(line), 'utf8').digest('hex');
}

export class AnalysisStore {
    constructor(dataDir) {
        this.dataDir = dataDir;
        this.jsonPath = path.join(dataDir, 'analyses.json');
        this.jsonlPath = path.join(dataDir, 'analyses.jsonl');
        /** @type {Map<string, object>} */
        this.map = new Map();
        this._flushTimer = undefined;
        this._flushing = Promise.resolve();
    }

    async init() {
        await fs.mkdir(this.dataDir, { recursive: true });
        try {
            const text = await fs.readFile(this.jsonPath, 'utf8');
            const obj = JSON.parse(text);
            for (const [k, v] of Object.entries(obj)) {
                this.map.set(k, v);
            }
        } catch (e) {
            if (e.code !== 'ENOENT') {
                throw e;
            }
        }
        return this;
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

    async put(line, analysis, model) {
        const hash = hashLine(line);
        const record = {
            hash,
            line: normalizeLine(line),
            analysis,
            model: model ?? null,
            createdAt: new Date().toISOString(),
        };
        this.map.set(hash, record);
        // Append to the event log immediately (cheap, crash-safe-ish).
        try {
            await fs.appendFile(this.jsonlPath, JSON.stringify(record) + '\n', 'utf8');
        } catch {
            /* non-fatal: canonical json is the source of truth */
        }
        this._scheduleFlush();
        return record;
    }

    _scheduleFlush() {
        if (this._flushTimer) {
            return;
        }
        this._flushTimer = setTimeout(() => {
            this._flushTimer = undefined;
            this._flushing = this.flush();
        }, 500);
        // Do not keep the event loop alive solely for a pending flush.
        if (typeof this._flushTimer.unref === 'function') {
            this._flushTimer.unref();
        }
    }

    async flush() {
        const obj = Object.fromEntries(this.map);
        const tmp = this.jsonPath + '.tmp';
        await fs.writeFile(tmp, JSON.stringify(obj, null, 0), 'utf8');
        await fs.rename(tmp, this.jsonPath); // atomic replace, no unlink needed
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
        const grammarFreq = new Map();
        const lemmaFreq = new Map();
        let tokenTotal = 0;
        let grammarTotal = 0;

        for (const rec of this.map.values()) {
            byModel[rec.model ?? 'unknown'] = (byModel[rec.model ?? 'unknown'] ?? 0) + 1;
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
            tokenTotal,
            grammarTotal,
            uniqueGrammar: grammarFreq.size,
            uniqueLemma: lemmaFreq.size,
            byModel,
            byLevel,
            topGrammar: top(grammarFreq, 30),
            topWords: top(lemmaFreq, 50),
        };
    }

    /** Rows for export as JSONL or CSV. */
    exportRows() {
        return [...this.map.values()];
    }
}
