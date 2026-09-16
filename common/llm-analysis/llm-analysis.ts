import {
    type AnalyzeOptions,
    type AnalyzedToken,
    type GrammarPoint,
    type LlmConfig,
    LlmAnalysisError,
    type SubtitleAnalysis,
} from './types';

/**
 * System prompt: instructs the model to act as a Japanese teacher for a
 * Chinese-speaking learner and to return a strict JSON object. Kept in one
 * place so it can be tuned without touching call sites.
 */
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

interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

function buildUserContent(line: string, options?: AnalyzeOptions): string {
    const parts: string[] = [];
    if (options?.contextBefore) {
        parts.push(`【上文】${options.contextBefore}`);
    }
    parts.push(`【需要分析的台词】${line}`);
    if (options?.contextAfter) {
        parts.push(`【下文】${options.contextAfter}`);
    }
    parts.push('请分析【需要分析的台词】这一行，按要求只返回 JSON。上下文仅用于理解语境，不要分析上下文本身。');
    return parts.join('\n');
}

/** Normalize a base URL and produce the chat completions endpoint. */
export function chatCompletionsUrl(baseUrl: string): string {
    const trimmed = baseUrl.replace(/\/+$/, '');
    // Allow callers to pass either ".../v1" or the full ".../chat/completions".
    if (trimmed.endsWith('/chat/completions')) {
        return trimmed;
    }
    return `${trimmed}/chat/completions`;
}

/**
 * Pull a JSON object out of a model response. Handles the common cases where a
 * model wraps JSON in ```json fences or adds stray prose despite instructions.
 */
export function extractJsonObject(content: string): unknown {
    const trimmed = content.trim();
    // Strip markdown fences if present.
    const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenceMatch ? fenceMatch[1].trim() : trimmed;
    try {
        return JSON.parse(candidate);
    } catch {
        // Fall back to the substring between the first { and the last }.
        const first = candidate.indexOf('{');
        const last = candidate.lastIndexOf('}');
        if (first !== -1 && last !== -1 && last > first) {
            return JSON.parse(candidate.slice(first, last + 1));
        }
        throw new LlmAnalysisError('模型返回的内容不是合法 JSON');
    }
}

function asString(value: unknown): string {
    return typeof value === 'string' ? value : value == null ? '' : String(value);
}

/** Validate and coerce a raw parsed object into a SubtitleAnalysis. */
export function coerceAnalysis(raw: unknown, original: string): SubtitleAnalysis {
    if (typeof raw !== 'object' || raw === null) {
        throw new LlmAnalysisError('模型返回的 JSON 不是对象');
    }
    const obj = raw as Record<string, unknown>;

    const tokensRaw = Array.isArray(obj.tokens) ? obj.tokens : [];
    const tokens: AnalyzedToken[] = tokensRaw
        .filter((t): t is Record<string, unknown> => typeof t === 'object' && t !== null)
        .map((t) => {
            const token: AnalyzedToken = {
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
    const grammar: GrammarPoint[] = grammarRaw
        .filter((g): g is Record<string, unknown> => typeof g === 'object' && g !== null)
        .map((g) => {
            const point: GrammarPoint = {
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

    const analysis: SubtitleAnalysis = {
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
 * Returns a structured {@link SubtitleAnalysis} with a Chinese translation,
 * token breakdown, and grammar points.
 *
 * @throws {LlmAnalysisError} on network, HTTP, or parsing failure.
 */
export async function analyzeSubtitle(
    line: string,
    config: LlmConfig,
    options?: AnalyzeOptions
): Promise<SubtitleAnalysis> {
    const text = line.trim();
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

    const messages: ChatMessage[] = [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserContent(text, options) },
    ];

    const body = {
        model: config.model,
        messages,
        temperature: options?.temperature ?? 0.2,
        response_format: { type: 'json_object' as const },
        stream: false,
    };

    // Set up cancellation / timeout.
    let signal = options?.signal;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (!signal) {
        const controller = new AbortController();
        signal = controller.signal;
        timer = setTimeout(() => controller.abort(), options?.timeoutMs ?? 30000);
    }

    let response: Response;
    try {
        response = await fetch(chatCompletionsUrl(config.baseUrl), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${config.apiKey}`,
            },
            body: JSON.stringify(body),
            signal,
        });
    } catch (e) {
        if ((e as Error)?.name === 'AbortError') {
            throw new LlmAnalysisError('请求超时或被取消', e);
        }
        throw new LlmAnalysisError('网络请求失败，请检查 API 地址与网络', e);
    } finally {
        if (timer) {
            clearTimeout(timer);
        }
    }

    if (!response.ok) {
        let detail = '';
        try {
            detail = await response.text();
        } catch {
            /* ignore */
        }
        throw new LlmAnalysisError(`API 返回错误 ${response.status}: ${detail.slice(0, 300)}`);
    }

    let payload: any;
    try {
        payload = await response.json();
    } catch (e) {
        throw new LlmAnalysisError('无法解析 API 响应 JSON', e);
    }

    const content: unknown = payload?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.length === 0) {
        throw new LlmAnalysisError('API 响应中没有文本内容');
    }

    const parsed = extractJsonObject(content);
    return coerceAnalysis(parsed, text);
}
