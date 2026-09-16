/**
 * Types for LLM-powered subtitle analysis (Japanese -> Chinese translation +
 * grammar / morphology breakdown for language learners).
 *
 * This module is intentionally provider-agnostic: it targets any
 * OpenAI-compatible `/chat/completions` endpoint (OpenAI, DeepSeek, Moonshot,
 * a local Ollama/vLLM gateway, etc.). The only requirement is that the endpoint
 * accepts the OpenAI chat schema and can return a JSON object.
 */

/** Part of speech, kept as a short human-readable label produced by the model. */
export type PartOfSpeech = string;

/** A single analyzed token (word / morpheme) of the sentence. */
export interface AnalyzedToken {
    /** Surface form as it appears in the sentence (表層形). */
    surface: string;
    /** Kana reading of the surface form (ふりがな). Empty for punctuation/latin. */
    reading: string;
    /** Dictionary / lemma form (辞書形). Optional — same as surface when uninflected. */
    lemma?: string;
    /** Short part-of-speech label, e.g. "名詞", "動詞", "助詞". */
    pos: PartOfSpeech;
    /** Concise Chinese gloss for this token in context. */
    gloss: string;
    /**
     * If this token is an inflected form, a short note on the conjugation,
     * e.g. "て形" / "使役受身" / "past polite". Optional.
     */
    inflection?: string;
}

/** A grammar point worth explaining to a learner. */
export interface GrammarPoint {
    /** The grammar pattern, e.g. "〜ておく", "〜なければならない". */
    pattern: string;
    /** Chinese explanation of what the pattern means and its nuance. */
    explanation: string;
    /** Rough JLPT level if the model can estimate it, e.g. "N4". Optional. */
    level?: string;
}

/** Full structured analysis of one subtitle line. */
export interface SubtitleAnalysis {
    /** The original Japanese line that was analyzed. */
    original: string;
    /** Natural Chinese translation of the whole line. */
    translation: string;
    /** Full-sentence kana reading (optional, may be empty). */
    reading?: string;
    /** Token-by-token breakdown, in reading order. */
    tokens: AnalyzedToken[];
    /** Grammar points present in the line. */
    grammar: GrammarPoint[];
    /** Any extra learner-facing note (idioms, register, slang). Optional. */
    notes?: string;
}

/** Configuration for the OpenAI-compatible endpoint. */
export interface LlmConfig {
    /** API key sent as `Authorization: Bearer <apiKey>`. */
    apiKey: string;
    /**
     * Base URL of the OpenAI-compatible API, WITHOUT the trailing
     * `/chat/completions`. Examples:
     *  - OpenAI:   https://api.openai.com/v1
     *  - DeepSeek: https://api.deepseek.com/v1
     *  - Ollama:   http://127.0.0.1:11434/v1
     */
    baseUrl: string;
    /** Model name, e.g. "deepseek-chat", "gpt-4o-mini", "qwen2.5:14b". */
    model: string;
}

/** Optional per-call knobs. */
export interface AnalyzeOptions {
    /** Preceding line(s), passed to the model as context for disambiguation. */
    contextBefore?: string;
    /** Following line(s), passed to the model as context. */
    contextAfter?: string;
    /** Abort signal to cancel an in-flight request. */
    signal?: AbortSignal;
    /** Request timeout in ms (default 30000). Ignored if `signal` is provided. */
    timeoutMs?: number;
    /** Sampling temperature (default 0.2 for stable structured output). */
    temperature?: number;
}

/** Error thrown when the LLM call or parsing fails. */
export class LlmAnalysisError extends Error {
    readonly cause?: unknown;
    constructor(message: string, cause?: unknown) {
        super(message);
        this.name = 'LlmAnalysisError';
        this.cause = cause;
    }
}
