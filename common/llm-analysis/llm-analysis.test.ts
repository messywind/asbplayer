import { afterEach, describe, expect, it, jest } from '@jest/globals';
import {
    analyzeSubtitle,
    chatCompletionsUrl,
    coerceAnalysis,
    extractJsonObject,
    LlmAnalysisError,
    type LlmConfig,
} from '@project/common/llm-analysis';

describe('chatCompletionsUrl', () => {
    it('appends the chat completions path to a /v1 base url', () => {
        expect(chatCompletionsUrl('https://api.deepseek.com/v1')).toBe('https://api.deepseek.com/v1/chat/completions');
    });

    it('trims trailing slashes', () => {
        expect(chatCompletionsUrl('https://api.openai.com/v1/')).toBe('https://api.openai.com/v1/chat/completions');
    });

    it('leaves an already-complete url untouched', () => {
        expect(chatCompletionsUrl('http://x/v1/chat/completions')).toBe('http://x/v1/chat/completions');
    });
});

describe('extractJsonObject', () => {
    it('parses a bare JSON object', () => {
        expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
    });

    it('parses JSON wrapped in a markdown fence', () => {
        expect(extractJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    });

    it('recovers JSON surrounded by stray prose', () => {
        expect(extractJsonObject('Here you go: {"a":1} done')).toEqual({ a: 1 });
    });

    it('throws on non-JSON', () => {
        expect(() => extractJsonObject('not json at all')).toThrow(LlmAnalysisError);
    });
});

describe('coerceAnalysis', () => {
    const original = '朝ご飯を食べておいた。';

    it('coerces a well-formed model object', () => {
        const raw = {
            translation: '(我)事先吃了早饭。',
            reading: 'あさごはんをたべておいた。',
            tokens: [
                { surface: '朝ご飯', reading: 'あさごはん', pos: '名詞', gloss: '早饭' },
                {
                    surface: '食べて',
                    reading: 'たべて',
                    lemma: '食べる',
                    pos: '動詞',
                    gloss: '吃',
                    inflection: 'て形',
                },
                { surface: 'おいた', reading: 'おいた', lemma: 'おく', pos: '補助動詞', gloss: '(表预先)' },
            ],
            grammar: [{ pattern: '〜ておく', explanation: '表示为将来做好准备。', level: 'N4' }],
            notes: '口语中 ておく 常缩约为 とく。',
        };
        const analysis = coerceAnalysis(raw, original);
        expect(analysis.original).toBe(original);
        expect(analysis.translation).toContain('早饭');
        expect(analysis.tokens).toHaveLength(3);
        expect(analysis.tokens[1].lemma).toBe('食べる');
        expect(analysis.tokens[1].inflection).toBe('て形');
        expect(analysis.grammar[0].pattern).toBe('〜ておく');
        expect(analysis.grammar[0].level).toBe('N4');
        expect(analysis.notes).toContain('とく');
    });

    it('drops empty tokens and lemma equal to surface', () => {
        const raw = {
            translation: '好。',
            tokens: [
                { surface: '', reading: '', pos: '', gloss: '' },
                { surface: 'いい', reading: 'いい', lemma: 'いい', pos: '形容詞', gloss: '好' },
            ],
            grammar: [],
        };
        const analysis = coerceAnalysis(raw, 'いい');
        expect(analysis.tokens).toHaveLength(1);
        expect(analysis.tokens[0].lemma).toBeUndefined();
    });

    it('tolerates missing tokens/grammar arrays', () => {
        const analysis = coerceAnalysis({ translation: '嗯。' }, 'うん');
        expect(analysis.tokens).toEqual([]);
        expect(analysis.grammar).toEqual([]);
    });

    it('throws when translation is missing', () => {
        expect(() => coerceAnalysis({ tokens: [] }, 'x')).toThrow(LlmAnalysisError);
    });

    it('throws on non-object input', () => {
        expect(() => coerceAnalysis('nope', 'x')).toThrow(LlmAnalysisError);
    });
});

describe('analyzeSubtitle (mocked fetch)', () => {
    const config: LlmConfig = {
        apiKey: 'test-key',
        baseUrl: 'https://api.example.com/v1',
        model: 'test-model',
    };

    const originalFetch = globalThis.fetch;
    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    // jsdom does not provide the WHATWG `Response` global, so use a minimal fake
    // exposing only what analyzeSubtitle reads: ok / status / json() / text().
    const fakeResponse = (body: unknown, status = 200) =>
        ({
            ok: status >= 200 && status < 300,
            status,
            json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
            text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
        }) as unknown as Response;

    it('sends an OpenAI-style request and parses the response', async () => {
        const modelJson = JSON.stringify({
            translation: '你好。',
            tokens: [{ surface: 'こんにちは', reading: 'こんにちは', pos: '感動詞', gloss: '你好' }],
            grammar: [],
        });
        const fetchMock = jest
            .fn<typeof fetch>()
            .mockResolvedValue(fakeResponse({ choices: [{ message: { content: modelJson } }] }, 200));
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        const analysis = await analyzeSubtitle('こんにちは', config);
        expect(analysis.translation).toBe('你好。');
        expect(analysis.tokens[0].surface).toBe('こんにちは');

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe('https://api.example.com/v1/chat/completions');
        expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-key');
        const sentBody = JSON.parse(init.body as string);
        expect(sentBody.model).toBe('test-model');
        expect(sentBody.response_format).toEqual({ type: 'json_object' });
        expect(sentBody.messages).toHaveLength(2);
    });

    it('throws a friendly error on non-200', async () => {
        globalThis.fetch = jest
            .fn<typeof fetch>()
            .mockResolvedValue(fakeResponse('unauthorized', 401)) as unknown as typeof fetch;
        await expect(analyzeSubtitle('こんにちは', config)).rejects.toThrow(LlmAnalysisError);
    });

    it('rejects an empty line without calling fetch', async () => {
        const fetchMock = jest.fn<typeof fetch>();
        globalThis.fetch = fetchMock as unknown as typeof fetch;
        await expect(analyzeSubtitle('   ', config)).rejects.toThrow(LlmAnalysisError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects when apiKey is missing', async () => {
        await expect(analyzeSubtitle('こんにちは', { ...config, apiKey: '' })).rejects.toThrow(LlmAnalysisError);
    });
});
