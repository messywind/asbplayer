// LLM analysis core for the cache/proxy server.
//
// This is a plain-ESM, zero-dependency port of `common/llm-analysis`
// (SYSTEM_PROMPT, request shape, JSON extraction, coercion). It is intentionally
// self-contained so the server deploys with just `node server.mjs` — no build
// step, no bundler. If you tune the prompt or output schema, keep this in sync
// with common/llm-analysis/llm-analysis.ts.

export class LlmAnalysisError extends Error {
    constructor(message, cause) {
        super(message);
        this.name = 'LlmAnalysisError';
        if (cause !== undefined) {
            this.cause = cause;
        }
    }
}

export const SYSTEM_PROMPT = `你是一位面向中文母语者的日语老师，专长是把动画/日剧台词讲解给正在学习日语的学生。
你会收到一行日语台词（有时附带上下文），请你分析它并**只输出一个 JSON 对象**，不要输出任何解释性文字、Markdown 代码块或多余内容。

JSON 必须严格符合以下结构：
{
  "translation": "整句自然流畅的中文翻译（不要逐字硬翻，要符合中文表达习惯）",
  "reading": "整句的假名读音（把汉字都标成假名；若整句本来就是假名可原样返回）",
  "tokens": [
    {
      "surface": "台词中出现的原形（表層形）",
      "reading": "该词的假名读音（标点或纯拉丁字母可留空字符串）",
      "lemma": "辞书形/原形（若该词有活用变形；无变形可省略或与 surface 相同）",
      "pos": "简短词性，如 名詞/動詞/形容詞/助詞/助動詞/副詞/接続詞/感動詞/記号",
      "gloss": "该词在此语境下的简明中文词义",
      "inflection": "若有活用，简述其变形，如 て形/た形/使役受身/否定/敬体；无则省略"
    }
  ],
  "grammar": [
    {
      "pattern": "句中出现的语法点，如 〜ておく / 〜てしまう / 〜なければならない / 〜たがる",
      "explanation": "该语法点的中文讲解：含义、用法、在本句中的作用",
      "level": "大致 JLPT 等级，如 N5/N4/N3/N2/N1（不确定可省略）"
    }
  ],
  "notes": "可选：俚语、惯用句、语气/敬体简体、省略、口语缩约等值得提醒学习者的点；没有则省略"
}

要求：
- tokens 按台词中出现的顺序排列，覆盖整句（可省略纯标点）。
- 只提取真正对学习者有价值的 grammar 语法点；如果句子很简单没有明显语法点，grammar 返回空数组 []。
- 所有讲解性文字用简体中文。
- 严格输出合法 JSON，字符串内的引号要正确转义。`;

export const BATCH_SYSTEM_PROMPT = `${SYSTEM_PROMPT}

批量模式补充规则（优先于上面关于“一行台词”和顶层 JSON 结构的说明）：
- 你会收到一个包含多条台词的 JSON 数组，每条都有 id 和 line。
- 必须逐条独立分析，不得合并、省略或改变顺序。
- 只输出一个 JSON 对象：{"results":[...]} 。
- results 中每项必须原样返回对应 id，并在同一对象中返回 translation、reading、tokens、grammar 和可选 notes。`;

const HTML_TAG_REGEX = /<[^>]+>/g;
// ASS/SSA inline override blocks like {\an8} or {\i1}.
const ASS_OVERRIDE_REGEX = /\{[^}]*\}/g;

/** Normalize a subtitle line into the canonical text used for hashing & analysis. */
export function normalizeLine(line) {
    return String(line ?? '')
        .replace(HTML_TAG_REGEX, '')
        .replace(ASS_OVERRIDE_REGEX, '')
        .replace(/​/g, '')
        .replace(/\r/g, '')
        .replace(/[ \t]+\n/g, '\n')
        .trim();
}

function buildUserContent(line, options = {}) {
    const parts = [];
    if (options.contextBefore) {
        parts.push(`【上文】${options.contextBefore}`);
    }
    parts.push(`【需要分析的台词】${line}`);
    if (options.contextAfter) {
        parts.push(`【下文】${options.contextAfter}`);
    }
    parts.push('请分析【需要分析的台词】这一行，按要求只返回 JSON。上下文仅用于理解语境，不要分析上下文本身。');
    return parts.join('\n');
}

/** Normalize a base URL and produce the chat completions endpoint. */
export function chatCompletionsUrl(baseUrl) {
    const trimmed = String(baseUrl ?? '').replace(/\/+$/, '');
    if (trimmed.endsWith('/chat/completions')) {
        return trimmed;
    }
    return `${trimmed}/chat/completions`;
}

/** Pull a JSON object out of a model response (handles fences / stray prose). */
export function extractJsonObject(content) {
    const trimmed = String(content ?? '').trim();
    const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenceMatch ? fenceMatch[1].trim() : trimmed;
    try {
        return JSON.parse(candidate);
    } catch {
        const first = candidate.indexOf('{');
        const last = candidate.lastIndexOf('}');
        if (first !== -1 && last !== -1 && last > first) {
            return JSON.parse(candidate.slice(first, last + 1));
        }
        throw new LlmAnalysisError('模型返回的内容不是合法 JSON');
    }
}

function asString(value) {
    return typeof value === 'string' ? value : value == null ? '' : String(value);
}

/** Validate and coerce a raw parsed object into a SubtitleAnalysis. */
export function coerceAnalysis(raw, original) {
    if (typeof raw !== 'object' || raw === null) {
        throw new LlmAnalysisError('模型返回的 JSON 不是对象');
    }
    const obj = raw;

    const tokensRaw = Array.isArray(obj.tokens) ? obj.tokens : [];
    const tokens = tokensRaw
        .filter((t) => typeof t === 'object' && t !== null)
        .map((t) => {
            const token = {
                surface: asString(t.surface),
                reading: asString(t.reading),
                pos: asString(t.pos),
                gloss: asString(t.gloss),
            };
            const lemma = asString(t.lemma);
            if (lemma && lemma !== token.surface) {
                token.lemma = lemma;
            }
            const inflection = asString(t.inflection);
            if (inflection) {
                token.inflection = inflection;
            }
            return token;
        })
        .filter((t) => t.surface.length > 0);

    const grammarRaw = Array.isArray(obj.grammar) ? obj.grammar : [];
    const grammar = grammarRaw
        .filter((g) => typeof g === 'object' && g !== null)
        .map((g) => {
            const point = {
                pattern: asString(g.pattern),
                explanation: asString(g.explanation),
            };
            const level = asString(g.level);
            if (level) {
                point.level = level;
            }
            return point;
        })
        .filter((g) => g.pattern.length > 0);

    const analysis = {
        original,
        translation: asString(obj.translation),
        tokens,
        grammar,
    };
    const reading = asString(obj.reading);
    if (reading) {
        analysis.reading = reading;
    }
    const notes = asString(obj.notes);
    if (notes) {
        analysis.notes = notes;
    }

    if (!analysis.translation) {
        throw new LlmAnalysisError('模型没有返回翻译内容');
    }
    return analysis;
}

/**
 * Analyze a single Japanese subtitle line against an OpenAI-compatible endpoint.
 *
 * @param {string} line
 * @param {{apiKey:string, baseUrl:string, model:string}} config
 * @param {{contextBefore?:string, contextAfter?:string, temperature?:number,
 *          timeoutMs?:number, fetchImpl?:typeof fetch}} [options]
 * @returns {Promise<object>} SubtitleAnalysis
 */
export async function analyzeLine(line, config, options = {}) {
    const text = normalizeLine(line);
    if (!text) {
        throw new LlmAnalysisError('台词为空');
    }
    if (!config.apiKey) {
        throw new LlmAnalysisError('未配置 API Key');
    }
    if (!config.baseUrl) {
        throw new LlmAnalysisError('未配置 API 地址 (baseUrl)');
    }
    if (!config.model) {
        throw new LlmAnalysisError('未配置模型名称');
    }

    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserContent(text, options) },
    ];
    const body = {
        model: config.model,
        messages,
        temperature: options.temperature ?? 0.2,
        response_format: { type: 'json_object' },
        stream: false,
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 60000);

    let response;
    try {
        response = await fetchImpl(chatCompletionsUrl(config.baseUrl), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${config.apiKey}`,
            },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
    } catch (e) {
        if (e?.name === 'AbortError') {
            throw new LlmAnalysisError('请求超时或被取消', e);
        }
        throw new LlmAnalysisError('网络请求失败，请检查 API 地址与网络', e);
    } finally {
        clearTimeout(timer);
    }

    if (!response.ok) {
        let detail = '';
        try {
            detail = await response.text();
        } catch {
            /* ignore */
        }
        throw new LlmAnalysisError(`API 返回错误 ${response.status}: ${String(detail).slice(0, 300)}`);
    }

    let payload;
    try {
        payload = await response.json();
    } catch (e) {
        throw new LlmAnalysisError('无法解析 API 响应 JSON', e);
    }

    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.length === 0) {
        throw new LlmAnalysisError('API 响应中没有文本内容');
    }

    const parsed = extractJsonObject(content);
    return coerceAnalysis(parsed, text);
}

/** Analyze multiple independent subtitle lines in one upstream request. */
export async function analyzeLines(lines, config, options = {}) {
    const texts = lines.map(normalizeLine);
    if (texts.length === 0) return [];
    if (texts.some((line) => !line)) throw new LlmAnalysisError('批量台词中包含空文本');
    if (!config.apiKey) throw new LlmAnalysisError('未配置 API Key');
    if (!config.baseUrl) throw new LlmAnalysisError('未配置 API 地址 (baseUrl)');
    if (!config.model) throw new LlmAnalysisError('未配置模型名称');

    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    const body = {
        model: config.model,
        messages: [
            { role: 'system', content: BATCH_SYSTEM_PROMPT },
            {
                role: 'user',
                content: JSON.stringify(texts.map((line, index) => ({ id: String(index), line }))),
            },
        ],
        temperature: options.temperature ?? 0.2,
        response_format: { type: 'json_object' },
        stream: false,
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 90000);
    let response;
    try {
        response = await fetchImpl(chatCompletionsUrl(config.baseUrl), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${config.apiKey}`,
            },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
    } catch (e) {
        if (e?.name === 'AbortError') throw new LlmAnalysisError('请求超时或被取消', e);
        throw new LlmAnalysisError('网络请求失败，请检查 API 地址与网络', e);
    } finally {
        clearTimeout(timer);
    }

    if (!response.ok) {
        let detail = '';
        try {
            detail = await response.text();
        } catch {
            /* ignore */
        }
        throw new LlmAnalysisError(`API 返回错误 ${response.status}: ${String(detail).slice(0, 300)}`);
    }

    let payload;
    try {
        payload = await response.json();
    } catch (e) {
        throw new LlmAnalysisError('无法解析 API 响应 JSON', e);
    }
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.length === 0) {
        throw new LlmAnalysisError('API 响应中没有文本内容');
    }

    const parsed = extractJsonObject(content);
    if (!Array.isArray(parsed?.results)) {
        throw new LlmAnalysisError('模型未返回批量 results 数组');
    }
    const byId = new Map();
    for (const item of parsed.results) {
        if (item && typeof item === 'object') byId.set(String(item.id ?? ''), item);
    }
    return texts.map((text, index) => {
        const item = byId.get(String(index));
        if (!item) throw new LlmAnalysisError(`模型缺少第 ${index + 1} 条台词的分析结果`);
        return coerceAnalysis(item.analysis && typeof item.analysis === 'object' ? item.analysis : item, text);
    });
}
