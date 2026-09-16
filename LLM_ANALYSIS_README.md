# AI 语法分析面板（LLM Analysis）

在 asbplayer 里新增的功能：看番剧时，对**当前字幕行**实时给出
**中文整句翻译 + 逐词词法（假名/词性/词义）+ 语法点讲解**。
词典悬停查词、音高重音、生词标记 / Anki 导出等能力继续用 asbplayer 原有的 Yomitan 集成，
本功能只补上原来缺失的“整句翻译 + 语法点讲解”。

分析由任意 **OpenAI 兼容**的 `/chat/completions` 接口驱动（OpenAI、DeepSeek、
Moonshot、本地 Ollama 网关都行），你只要填 API Key、接口地址、模型名即可。

---

## 快速开始

### 1. 安装依赖并启动（本地 Web 应用）

```bash
cd "asbplayer-study"
corepack yarn install          # 首次安装依赖
corepack yarn workspace @project/client start
```

启动后浏览器打开终端里给出的地址（默认 `http://localhost:5173`）。
把本地视频文件和 jimaku 下载的日文字幕（.srt/.ass）拖进页面即可播放。

> 说明：本仓库用的是 Yarn 3（Berry），所以命令前加 `corepack`。
> 如果你已经全局装了对应版本的 yarn，可以直接用 `yarn ...`。

### 2. 配置 LLM

打开右上角 **设置（Settings）→ Misc（杂项）→ AI Grammar Analysis**：

- **Enable AI analysis panel**：打开分析面板（默认关闭）。
- **Auto-analyze current subtitle**：字幕切换时自动分析（默认开）。关掉则改为手动点“Analyze”。
- **API Key**：你的密钥。
- **API Base URL**：OpenAI 兼容地址，**不要带** `/chat/completions`。
- **Model**：模型名。

推荐默认（便宜、日→中效果好、国内可直连）：

| 服务 | API Base URL | Model |
|------|--------------|-------|
| DeepSeek（默认） | `https://api.deepseek.com/v1` | `deepseek-chat` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| 本地 Ollama | `http://127.0.0.1:11434/v1` | 如 `qwen2.5:14b` |

填好后，播放到有日文字幕的地方，右侧面板就会显示：

- **Translation**：整句中文翻译
- **Reading**：整句假名读音
- **Words**：逐词卡片（假名在上、原词居中、中文词义在下；悬停显示词性/活用）
- **Grammar**：句中语法点（模式 + 中文讲解 + 大致 JLPT 等级）
- 底部可能有一条口语/惯用法提示

分析结果会按“字幕原文”缓存，重复出现的台词不会重复请求。

---

## 改了哪些文件

新增：

- `common/llm-analysis/` — 与 UI 解耦的分析引擎
  - `types.ts` — 类型定义（`SubtitleAnalysis` / `AnalyzedToken` / `GrammarPoint` / `LlmConfig` …）
  - `llm-analysis.ts` — `analyzeSubtitle()` 主函数、提示词、JSON 解析/校验
  - `llm-analysis.test.ts` — 单元测试（16 个用例，全绿）
  - `index.ts` — 导出
- `common/app/components/SubtitleAnalysisPanel.tsx` — 右侧分析面板 React 组件

改动：

- `common/settings/settings.ts` — 新增 `LlmAnalysisSettings` 接口并并入 `AsbplayerSettings`
- `common/settings/settings-provider.ts` — 新增默认值
- `common/settings/settings-import-export.ts` — 把新字段登记进导入/导出白名单
- `common/components/MiscSettingsTab.tsx` — 在 Misc 标签页里加“AI Grammar Analysis”设置区
- `common/app/components/Player.tsx` — 记录“当前显示字幕”并在字幕列表右侧挂载分析面板
- `common/locales/en.json` — 新增文案键

---

## 设计要点

- **提供商无关**：只依赖 OpenAI Chat Completions 规范 + `response_format: json_object`，
  换服务只改 3 个设置项，不用改代码。
- **与 asbplayer 解耦**：`common/llm-analysis` 不依赖任何 asbplayer 内部模块，
  纯 `fetch`，可单独测试/复用。
- **稳健解析**：即便模型输出带 ```json ``` 代码块或多余文字，也能提取出 JSON；
  字段缺失/类型不对会被容错处理，翻译缺失才报错。
- **不打断播放**：请求带超时与取消（字幕快速切换时自动放弃上一条请求），结果按原文缓存。

---

## 已验证

- `common/llm-analysis` 单元测试：**16/16 通过**（真实 Jest 工具链）。
- 设置导入/导出测试：**16/16 通过**（确认新设置项登记正确）。
- `tsc --noEmit` 对 `common` 工作区：**0 错误**。
- 客户端生产构建 `yarn workspace @project/client run buildFast`：**构建成功**。

---

## 注意 / 后续可做

- **多语言文案**：新文案只加进了 `en.json`，其他语言运行时会回退到英文。
  若要跑生产构建 `yarn ... build`（它会执行 `verify` 里的 loc 校验），需要把这些键补进其余 `common/locales/*.json`。开发模式 `start` 不受影响。
- **逐词词法用的是 LLM**：第一版为了“开箱即用”，Words 的假名/词性由 LLM 给出；
  它和 asbplayer 原生的 Yomitan 悬停查词是互补的（Yomitan 更权威、带频率/音高，但需要本地跑 Yomitan 服务）。
  后续可把 Words 部分切换为复用 `common/yomitan` 的 `tokenize()`，与词典数据打通。
- **发音/音高**：目前靠听原声 + LLM 读音标注；如需精确音高重音，走 Yomitan 的 pitch accent 数据。
- **没有字幕的番**：本功能针对“有日文字幕”的场景（配合 jimaku）。生肉无字幕需要额外接语音识别（Whisper），
  准确率有限，属于下一阶段。
