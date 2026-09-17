// Node built-in test runner:  node --test server/
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { AnalysisStore, hashLine } from './lib/store.mjs';
import { analyzeLine, analyzeLines, extractJsonObject, coerceAnalysis, normalizeLine, LlmAnalysisError } from './lib/llm.mjs';
import { MultiUserDatabase } from './lib/database.mjs';
import { decryptSecret, encryptSecret, hashPassword, verifyPassword } from './lib/auth.mjs';

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

test('analyzeLines sends one upstream request for multiple subtitles', async () => {
    const second = { ...SAMPLE, translation: '早上好。' };
    const f = fakeFetch({
        results: [
            { id: '0', ...SAMPLE },
            { id: '1', ...second },
        ],
    });
    const analyses = await analyzeLines(
        ['次は', 'おはよう'],
        { apiKey: 'k', baseUrl: 'https://x/v1', model: 'm' },
        { fetchImpl: f }
    );
    assert.equal(f.calls(), 1);
    assert.deepEqual(analyses.map((analysis) => analysis.original), ['次は', 'おはよう']);
    assert.deepEqual(analyses.map((analysis) => analysis.translation), [SAMPLE.translation, second.translation]);
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

test('store organizes analyses by anime/episode and reloads them', async () => {
    const dir = await tmpDir();
    const s = await new AnalysisStore(dir).init();
    await s.put('次は', SAMPLE, 'deepseek-chat', 'Frieren', '28');
    await s.close();

    // Episode file lives at DATA_DIR/<anime>/<episode>.json.
    const epFile = path.join(dir, 'Frieren', '28.json');
    const raw = JSON.parse(await fs.readFile(epFile, 'utf8'));
    assert.equal(raw.anime, 'Frieren');
    assert.equal(raw.episode, '28');

    const s2 = await new AnalysisStore(dir).init();
    // episodeHas is scoped to the show/episode.
    assert.ok(s2.episodeHas('Frieren', '28', '次は'));
    assert.ok(!s2.episodeHas('Frieren', '01', '次は'));
    // Normalized-equivalent line still hits within the episode.
    assert.ok(s2.episodeHas('Frieren', '28', '{\\an8}次は'));

    // getEpisode returns { normalizedLine: analysis } for bulk client load.
    const ep = s2.getEpisode('Frieren', '28');
    assert.equal(ep.count, 1);
    assert.equal(ep.analyses['次は'].translation, SAMPLE.translation);

    // Global dedup index still works across episodes.
    assert.ok(s2.get('次は'));
    await s2.close();
});

test('store library lists shows and episode line counts', async () => {
    const dir = await tmpDir();
    const s = await new AnalysisStore(dir).init();
    await s.put('次は', SAMPLE, 'm', 'Frieren', '28');
    await s.put('おはよう', { ...SAMPLE, translation: '早上好。' }, 'm', 'Frieren', '01');
    const lib = s.library();
    const frieren = lib.find((x) => x.anime === 'Frieren');
    assert.ok(frieren);
    assert.equal(frieren.episodes.length, 2);
    // Sorted numerically: 01 before 28.
    assert.equal(frieren.episodes[0].episode, '01');
    await s.close();
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

test('password hashes and encrypted API keys do not expose plaintext', async () => {
    const passwordHash = await hashPassword('a-long-test-password');
    assert.ok(!passwordHash.includes('a-long-test-password'));
    assert.equal(await verifyPassword('a-long-test-password', passwordHash), true);
    assert.equal(await verifyPassword('wrong-password', passwordHash), false);

    const encrypted = encryptSecret('sk-user-secret', 'test-encryption-secret-that-is-long-enough');
    assert.ok(!encrypted.includes('sk-user-secret'));
    assert.equal(decryptSecret(encrypted, 'test-encryption-secret-that-is-long-enough'), 'sk-user-secret');
});

test('multi-user archives are isolated while analyses are globally shared', async () => {
    const db = new MultiUserDatabase(':memory:');
    const admin = db.createUser('admin', 'hash', 'admin');
    const invite = db.createInvite(admin.id, 'invite-code', 2, new Date(Date.now() + 60_000).toISOString());
    assert.equal(invite.uses, 0);

    const alice = db.registerWithInvite({ code: 'invite-code', username: 'alice', passwordHash: 'a' });
    const bob = db.registerWithInvite({ code: 'invite-code', username: 'bob', passwordHash: 'b' });
    const aliceSpace = db.createSpace(alice.id, 'Frieren');
    const bobSpace = db.createSpace(bob.id, 'Private show');
    const aliceEpisode = db.createOrUpdateEpisode(alice.id, aliceSpace.id, '01', 'frieren-01.mkv');
    const bobEpisode = db.createOrUpdateEpisode(bob.id, bobSpace.id, '02', 'private-02.mkv');

    db.putAnalysis('次は', SAMPLE, 'deepseek-chat');
    db.associateAnalysis(alice.id, aliceEpisode.id, '次は');
    db.associateAnalysis(bob.id, bobEpisode.id, '次は');

    assert.equal(db.analysisCount, 1, 'the identical line has one global analysis');
    assert.deepEqual(
        db.library(alice.id).map((space) => space.name),
        ['Frieren']
    );
    assert.deepEqual(
        db.library(bob.id).map((space) => space.name),
        ['Private show']
    );
    assert.equal(db.getEpisode(alice.id, bobEpisode.id), undefined, 'users cannot read another user episode');
    assert.equal(db.getEpisode(alice.id, aliceEpisode.id).analyses['次は'].translation, SAMPLE.translation);
    db.close();
});

test('usage summaries distinguish external calls from cache hits', () => {
    const db = new MultiUserDatabase(':memory:');
    const user = db.createUser('usage-user', 'hash');
    db.recordApiUsage(user.id, { model: 'deepseek-chat', cached: false });
    db.recordApiUsage(user.id, { model: 'deepseek-chat', cached: true });
    db.recordApiUsage(user.id, { model: 'deepseek-chat', cached: true });

    assert.deepEqual(db.usageSummary(user.id), {
        requests: 3,
        apiCalls: 1,
        cacheHits: 2,
        apiCalls30d: 1,
        lastUsedAt: db.usageSummary(user.id).lastUsedAt,
    });
    db.close();
});

test('public and admin user summaries include spaces without exposing episode details', () => {
    const db = new MultiUserDatabase(':memory:');
    const admin = db.createUser('admin-user', 'hash', 'admin');
    const learner = db.createUser('learner', 'hash');
    const space = db.createSpace(learner.id, 'Frieren');
    db.createOrUpdateEpisode(learner.id, space.id, '01', 'private-file-name.mkv');
    db.recordApiUsage(learner.id, { cached: false });

    const summary = db.userSummaries().find((user) => user.id === learner.id);
    assert.ok(summary);
    assert.equal(summary.spaceCount, 1);
    assert.equal(summary.episodeCount, 1);
    assert.equal(summary.apiCalls, 1);
    assert.equal(summary.spaces[0].name, 'Frieren');
    assert.equal('mediaFileName' in summary.spaces[0], false);

    db.updateUser(learner.id, { username: 'learner-renamed', role: 'admin', disabled: false });
    assert.equal(db.getUserById(learner.id).role, 'admin');
    assert.equal(db.adminCount, 2);
    db.deleteUser(learner.id);
    assert.equal(db.getUserById(learner.id), undefined);
    assert.equal(db.getUserById(admin.id).username, 'admin-user');
    db.close();
});

test('users can delete their own episodes and spaces without deleting shared analyses', () => {
    const db = new MultiUserDatabase(':memory:');
    const alice = db.createUser('delete-alice', 'hash');
    const bob = db.createUser('delete-bob', 'hash');
    const aliceSpace = db.createSpace(alice.id, 'Alice show');
    const bobSpace = db.createSpace(bob.id, 'Bob show');
    const aliceEpisode = db.createOrUpdateEpisode(alice.id, aliceSpace.id, '01', 'alice.mkv');
    const bobEpisode = db.createOrUpdateEpisode(bob.id, bobSpace.id, '01', 'bob.mkv');
    db.putAnalysis('次は', SAMPLE, 'deepseek-chat');
    db.associateAnalysis(alice.id, aliceEpisode.id, '次は');
    db.associateAnalysis(bob.id, bobEpisode.id, '次は');

    assert.equal(db.deleteEpisode(alice.id, bobEpisode.id), false, 'cannot delete another user episode');
    assert.equal(db.deleteEpisode(alice.id, aliceEpisode.id), true);
    assert.equal(db.getEpisode(alice.id, aliceEpisode.id), undefined);
    assert.equal(db.analysisCount, 1, 'global cache remains after deleting an episode association');
    assert.equal(db.deleteSpace(alice.id, bobSpace.id), false, 'cannot delete another user space');
    assert.equal(db.deleteSpace(bob.id, bobSpace.id), true);
    assert.equal(db.library(bob.id).length, 0);
    db.close();
});
