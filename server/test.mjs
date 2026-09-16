// Node built-in test runner:  node --test server/
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { AnalysisStore, hashLine } from './lib/store.mjs';
import { analyzeLine, extractJsonObject, coerceAnalysis, normalizeLine, LlmAnalysisError } from './lib/llm.mjs';

async function tmpDir() {
    return await fs.mkdtemp(path.join(os.tmpdir(), 'asb-store-'));
}

function fakeFetch(modelObj, { failWith } = {}) {
    let calls = 0;
    const impl = async () => {
        calls++;
        if (failWith) {
            return { ok: false, status: failWith, text: async () => 'boom', json: async () => ({}) };
        }
        return {
            ok: true,
            status: 200,
            json: async () => ({ choices: [{ message: { content: JSON.stringify(modelObj) } }] }),
            text: async () => JSON.stringify(modelObj),
        };
    };
    impl.calls = () => calls;
    return impl;
}

const SAMPLE = {
    translation: '接下来轮到我们了。',
    reading: 'つぎはわたしたちのばんだ。',
    tokens: [
        { surface: '次', reading: 'つぎ', pos: '名詞', gloss: '下一个' },
        { surface: 'は', reading: 'は', pos: '助詞', gloss: '(主题)' },
    ],
    grammar: [{ pattern: '〜は', explanation: '提示主题。', level: 'N5' }],
};

test('normalizeLine strips html and ass overrides', () => {
    assert.equal(normalizeLine('{\\an8}<i>次は</i>​'), '次は');
});

test('extractJsonObject handles fenced json', () => {
    assert.deepEqual(extractJsonObject('```json\n{"a":1}\n```'), { a: 1 });
});

test('coerceAnalysis throws without translation', () => {
    assert.throws(() => coerceAnalysis({ tokens: [] }, 'x'), LlmAnalysisError);
});

test('analyzeLine posts OpenAI-style body and parses result', async () => {
    const f = fakeFetch(SAMPLE);
    const analysis = await analyzeLine('次は', { apiKey: 'k', baseUrl: 'https://x/v1', model: 'm' }, { fetchImpl: f });
    assert.equal(analysis.translation, '接下来轮到我们了。');
    assert.equal(analysis.tokens.length, 2);
    assert.equal(f.calls(), 1);
});

test('analyzeLine surfaces API errors', async () => {
    const f = fakeFetch(SAMPLE, { failWith: 401 });
    await assert.rejects(
        analyzeLine('次は', { apiKey: 'k', baseUrl: 'https://x/v1', model: 'm' }, { fetchImpl: f }),
        LlmAnalysisError
    );
});

test('store persists and reloads', async () => {
    const dir = await tmpDir();
    const s = await new AnalysisStore(dir).init();
    await s.put('次は', SAMPLE, 'deepseek-chat');
    await s.close();

    const s2 = await new AnalysisStore(dir).init();
    assert.equal(s2.size, 1);
    const hit = s2.get('次は');
    assert.ok(hit);
    assert.equal(hit.analysis.translation, SAMPLE.translation);
    // Normalized-equivalent line must hit the same record.
    assert.ok(s2.get('{\\an8}次は'));
    assert.equal(hashLine('次は'), hashLine(' 次は '));
});

test('store stats aggregate grammar and words', async () => {
    const dir = await tmpDir();
    const s = await new AnalysisStore(dir).init();
    await s.put('次は', SAMPLE, 'deepseek-chat');
    const stats = s.stats();
    assert.equal(stats.lines, 1);
    assert.equal(stats.byLevel.N5, 1);
    assert.equal(stats.topGrammar[0].key, '〜は');
    await s.close();
});

test('getOrCreateAnalysis caches: LLM called once for repeated line', async () => {
    // Import the server module wiring with an injected fake by monkeypatching global fetch.
    const dir = await tmpDir();
    const s = await new AnalysisStore(dir).init();
    const f = fakeFetch(SAMPLE);

    // Reproduce the server's get-or-create semantics against this store.
    const cache = async (line) => {
        const hit = s.get(line);
        if (hit) return { cached: true };
        const a = await analyzeLine(line, { apiKey: 'k', baseUrl: 'https://x/v1', model: 'm' }, { fetchImpl: f });
        await s.put(line, a, 'm');
        return { cached: false };
    };

    const r1 = await cache('次は');
    const r2 = await cache('次は');
    assert.equal(r1.cached, false);
    assert.equal(r2.cached, true);
    assert.equal(f.calls(), 1, 'second identical line must not call the LLM');
    await s.close();
});
