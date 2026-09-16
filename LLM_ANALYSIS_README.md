# AI 语法分析面板（LLM Analysis）

在 asbplayer 里新增的功能：看番剧时，对**当前字幕行**实时给出
**中文整句翻译 + 逐词词法（假名/罗马音/词性/词义）+ 语法点讲解**，并支持**点词发音**。
词典悬停查词、音高重音、生词标记 / Anki 导出等能力继续用 asbplayer 原有的 Yomitan 集成，
本功能只补上原来缺失的“整句翻译 + 语法点讲解 + 罗马音 + 发音”。

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

- **Translation**：整句中文翻译（可一键复制）
- **Reading**：整句假名读音 + 罗马音
- **Words**：逐词卡片（罗马音 + 假名在上、原词居中、中文词义在下；悬停显示词性/活用）。
  每个词可点击发音，整句旁的小喇叭则播放该行的**番剧原声**。
- **Grammar**：句中语法点（模式 + 中文讲解 + 大致 JLPT 等级）
- 底部可能有一条口语/惯用法提示

### 发音（整句原声 + 单词 VOICEVOX）

- **整句**：点句子旁的小喇叭，直接播放这一行对应的**番剧原声**（用 asbplayer 的
  `AudioClip` 截取当前视频的音频区间），最“纯”、就是声优本人。没加载视频时回退到合成语音。
- **单词**：点词卡走后端代理的 [VOICEVOX](https://voicevox.hiroshiba.jp/)（本地、免费、自然的日语神经 TTS）。
  没跑后端 / 没装 VOICEVOX 时，自动回退到浏览器自带 TTS。

分析结果会按“字幕原文”缓存，重复出现的台词不会重复请求。

#### VOICEVOX 引擎部署流程

VOICEVOX 是**完全本地**的日语语音合成引擎（基于深度学习，音色自然），免费、离线、不用 API Key。
它由两部分组成：**引擎（engine）**负责合成，**编辑器（editor，可选）**只是个试听界面。
本项目只需要**引擎**，它默认监听 `127.0.0.1:50021`，由后端用 `/api/tts` 代理转发（顺带绕开浏览器 CORS）。

**方式一：装桌面版 App（最省事，推荐个人使用）**

1. 打开官网 <https://voicevox.hiroshiba.jp/>，下载对应系统的安装包（Windows / macOS / Linux）。
2. 安装并启动 VOICEVOX。**只要 App 开着，引擎就在跑**（标题栏能看到引擎状态）。
3. 验证引擎已就绪：

   ```bash
   curl -s http://127.0.0.1:50021/version
   # 返回形如 "0.16.0" 即表示引擎正常
   ```

**方式二：只跑引擎（无 GUI，适合服务器 / 想开机自启）**

从 <https://github.com/VOICEVOX/voicevox_engine/releases> 下载对应平台的引擎压缩包，解压后启动：

```bash
# Linux x64
./run --host 127.0.0.1 --port 50021
# 也可以监听 0.0.0.0，供同一局域网内的其它机器使用
```

或者直接用 Docker（本地无需安装任何东西）：

```bash
docker run --rm -p '127.0.0.1:50021:50021' voicevox/voicevox_engine:cpu-latest
```

> 首次合成时引擎要加载模型，第一句会慢 1–2 秒，之后就是实时的。

**选音色（说话人 id）**

引擎启动后可以列出全部音色，拿到它们的 `id`：

```bash
curl -s http://127.0.0.1:50021/speakers | head -c 2000
```

把想要的音色 id 填进 `server/.env` 的 `VOICEVOX_SPEAKER`（例如常见的「ずんだもん（ノーマル）」，
**具体 id 以 `speakers` 的返回为准**，不同引擎版本编号可能不同）。

**接到本项目**

在 `server/.env` 里填：

```bash
VOICEVOX_URL=http://127.0.0.1:50021   # 引擎地址；跑在别的机器上就改成那台的地址
VOICEVOX_SPEAKER=1                     # 音色 id，用上面的 /speakers 查
```

重启 `node server.mjs` 后，`GET /api/health` 会多出一个 `tts: true` 字段，表示 TTS 已接通；
面板里点单词即由后端 `GET /api/tts?text=…&speaker=…` 合成并返回 WAV。

**没装会怎样？** `/api/tts` 返回 502，前端**自动回退**到浏览器自带的 `SpeechSynthesis`
（音色差一些，但不会报错打断你）。所以这一步是可选的。

### 3. 缓存 / 一次性分析整集 / 持久化（可选，推荐）

面板顶部有一个 **「分析整集字幕 (N)」** 按钮：点一下就用并发池把整条字幕轨里所有
不重复的台词一次性全解析、填进缓存，之后逐句播放直接秒出、不再逐句调接口。

默认缓存只在内存里（刷新即失）。如果你想**持久化到文件**、或**部署到服务器**、
或**拿数据做统计分析**，就再跑一个随仓库附带的零依赖后端 `server/`：

```bash
cd server
cp .env.example .env      # 填入 LLM_API_KEY
node server.mjs           # 默认 http://localhost:3939
```

然后在 **设置 → Misc → AI Grammar Analysis → Cache server URL** 填
`http://localhost:3939`。填了之后：

- API Key 只放在**服务端**，浏览器/部署时不再暴露，也没有 CORS 问题；
- 每句分析**按番剧 / 集数分文件夹**持久化到 `server/data/<番剧>/<集数>.json`（另有 `analyses.jsonl` 追加日志），
  内存里再维护一份全局哈希索引做跨集去重 —— **跨刷新/设备/用户复用，重看某集时整包秒载入**；
- 单词发音用的 VOICEVOX 也由该后端在 `/api/tts` 代理（规避浏览器 CORS）；
- `GET /api/stats`、`GET /api/library`、`GET /api/export?format=jsonl|csv` 可直接拿去做统计或喂给 AI。

详见 [`server/README.md`](server/README.md)。留空该设置项则退回“浏览器直连 + 内存缓存”。

---

## MKV 没声音？（音频编码不支持）

**症状**：MKV 视频画面正常，但**整个视频一点声音都没有**，怎么调音量、切音轨都没用。

**原因**：不是 asbplayer 的问题，而是**浏览器解不了这条音轨**。番剧的 `.mkv` 常用
**AC-3 / E-AC-3 / DTS / TrueHD** 这类编码，Chromium（以及据此打包的桌面版）**根本没有内置解码器**，
于是干脆不输出声音。`.ts` / `.m2ts` 录像、部分 E-AC-3 的 MP4 也一样。任何“取消静音 / 换音轨”的操作都不会有效。

**解决办法（在应用内，不需要外部脚本）**：播放器左上角会出现一个
**「No sound? … Repair audio」** 提示条（检测到音轨解不出来、或文件名是 `.mkv` 等格式时自动出现）。
点 **「Repair audio」** 后它会：

1. 用 [ffmpeg.wasm](https://ffmpegwasm.netlify.app/)（编译成 WebAssembly 的 ffmpeg）在**浏览器本地**
   把音轨从 AC-3/DTS 等**转成浏览器能播的立体声 AAC**（只转音频、不碰画面，所以快且小）；
2. 把转好的音频交给一个隐藏的 `<audio>` 元素，让它与画面**同步播放**
   （播放/暂停/拖动进度/变速/音量全都跟着走）。

一集 24 分钟的番，音频约 16 MB，转换通常十几秒到几十秒（取决于 CPU）；过程有进度百分比。
完成后提示条显示 “Audio repaired and playing.”，点 “Turn off” 可关掉恢复出来的音频。

**几点说明：**

- **按需加载**：ffmpeg 的 JS 胶水随应用打包，但 ~31 MB 的 wasm 内核是**第一次点“Repair audio”时才从 CDN 下载**，
  不点就不下载。默认走 jsDelivr。
- **CDN 慢 / 被墙？** 换成镜像或自建地址即可——在页面里设置
  `globalThis.__asbplayerFfmpegCoreUrl = 'https://你的镜像/@ffmpeg/core@0.12.10/dist/esm'`
  （指向同时含 `ffmpeg-core.js` 与 `ffmpeg-core.wasm` 的目录）。
- **只针对“整个视频没声”**：若只是某一条音轨不出声而其它音轨正常，用播放器底部的音轨切换即可。
- **暂不影响“整句原声”**：面板里整句发音走 asbplayer 原生的音轨截取，遇到不支持的编码它同样会没声；
  后续可改成复用上面转好的音频。
- 转换只在**本次播放**有效，刷新后要重新点一次（后续可做本集缓存）。

---

## 改了哪些文件

新增：

- `common/llm-analysis/` — 与 UI 解耦的分析引擎
  - `types.ts` — 类型定义（`SubtitleAnalysis` / `AnalyzedToken` / `GrammarPoint` / `LlmConfig` …）
  - `llm-analysis.ts` — `analyzeSubtitle()` 主函数、提示词、JSON 解析/校验
  - `backend-client.ts` — 走缓存服务器的客户端（`analyzeViaBackend` / `fetchEpisodeAnalyses` / `backendTtsUrl` / `fetchBackendStats` / `pingBackend`）
  - `episode-name.ts` — 从文件名解析「番剧 + 集数」（用来按集归档缓存）
  - `llm-analysis.test.ts` / `episode-name.test.ts` — 单元测试（Jest，全绿）
  - `index.ts` — 导出
- `common/app/components/SubtitleAnalysisPanel.tsx` — 右侧分析面板 React 组件（罗马音 + 点词/整句发音 + 整集批量分析 + 进度条 + 缓存状态 + 打开某集时整包载入）
- `common/app/services/video-audio-recovery.ts` — **MKV 无声修复**：用 ffmpeg.wasm 在浏览器内把不支持的音轨（AC-3/DTS…）转成 AAC，返回可播放的 Blob
- `common/app/services/sidecar-audio.ts` — 隐藏 `<audio>` 与 `<video>` 的同步控制器（镜像 play/pause/seek/rate/volume + 漂移校正）
- `server/` — 零依赖 Node 缓存/代理服务器（**按番剧/集数**文件持久化 + VOICEVOX TTS 代理 + 统计/导出/整集接口 + node 测试）

改动：

- `common/settings/settings.ts` — 新增 `LlmAnalysisSettings` 接口（含 `llmBackendUrl`）并并入 `AsbplayerSettings`
- `common/settings/settings-provider.ts` — 新增默认值
- `common/settings/settings-import-export.ts` — 把新字段登记进导入/导出白名单
- `common/components/MiscSettingsTab.tsx` — 在 Misc 标签页里加“AI Grammar Analysis”设置区（含 Cache server URL）
- `common/app/components/Player.tsx` — 记录“当前显示字幕”、把整条字幕轨与文件名传给面板、提供“播放该行番剧原声”的回调（基于 `AudioClip.fromFile`）、在字幕列表右侧挂载分析面板
- `common/app/components/VideoPlayer.tsx` — 检测音轨解不出来并在画面左上角给出“Repair audio”提示条，接上上面的转码 + 同步播放
- `common/package.json` — 新增依赖 `@ffmpeg/ffmpeg`、`@ffmpeg/util`
- `client/vite.config.ts` — `optimizeDeps.exclude` 掉这两个包，好让 Vite 正确产出 ffmpeg 的 module worker
- `common/locales/en.json` — 新增文案键（含 `audioRecovery.*`）

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

- `common/llm-analysis` 单元测试：**24/24 通过**（真实 Jest 工具链；含文件名解析 8 例）。
- 设置导入/导出测试：**通过**（确认新设置项登记正确）。
- 后端 `server/` node 测试：**10/10 通过**，含按番剧/集数落盘、`getEpisode`/`episodeHas`、`library` 与跨集去重。
- `tsc --noEmit` 对 `common` 与 `client` 工作区：**0 错误**。
- 客户端生产构建 `vite build`：**构建成功**，并确认 ffmpeg 的 module worker 被正确产出为独立资源
  （`assets/worker-*.js` 内含 `importScripts`/`createFFmpegCore`，由 `new Worker(new URL(...), {type:'module'})` 引用）。
- **MKV 音频转码命令**：用真实 ffmpeg 在「AC-3 5.1 的 MKV」上跑通
  `-map 0:a:0 -vn -ac 2 -c:a aac -b:a 160k`，输出为可播放的立体声 AAC（20 秒测试片段约 220 KB）。

> 说明：上面验证的是**构建链路**与**转码命令**。浏览器里 ffmpeg.wasm 的实际运行
> （下载 wasm 内核 → 转码 → 同步播放）需要真实环境，本机沙箱无法跑浏览器，请在本地 `corepack yarn workspace @project/client start`
> 里用一个 AC-3/DTS 的 `.mkv` 实测一次。若失败，控制台会给出明确错误，提示条上也会显示原因。

---

## 注意 / 后续可做

- **多语言文案**：新文案只加进了 `en.json`，其他语言运行时会回退到英文。
  若要跑生产构建 `yarn ... build`（它会执行 `verify` 里的 loc 校验），需要把这些键补进其余 `common/locales/*.json`。开发模式 `start` 不受影响。
- **逐词词法用的是 LLM**：第一版为了“开箱即用”，Words 的假名/词性由 LLM 给出；
  它和 asbplayer 原生的 Yomitan 悬停查词是互补的（Yomitan 更权威、带频率/音高，但需要本地跑 Yomitan 服务）。
  后续可把 Words 部分切换为复用 `common/yomitan` 的 `tokenize()`，与词典数据打通。
- **发音/音高**：整句用番剧原声、单词用 VOICEVOX，读音标注由 LLM 给出；如需精确音高重音，走 Yomitan 的 pitch accent 数据。
- **没有字幕的番**：本功能针对“有日文字幕”的场景（配合 jimaku）。生肉无字幕需要额外接语音识别（Whisper），
  准确率有限，属于下一阶段。
