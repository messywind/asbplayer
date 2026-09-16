# LLM 缓存 / 代理服务器

一个**零依赖**的 Node 服务，给 asbplayer 的「AI 语法分析」功能做四件事：

1. **把 API Key 放在服务端** —— 浏览器永远看不到 Key，部署到服务器也不会有 CORS / Key 泄露问题。
2. **把每一句的分析结果持久化到文件** —— 按「字幕原文的哈希」全局去重（同一句台词永远只分析、只花钱一次），同时**按番剧 / 集数分文件夹落盘**，重看某一集时可一次性载入、不再重跑。
3. **单词发音（VOICEVOX 代理）** —— 转发本地 VOICEVOX 引擎，给面板里的单词提供自然的日语 TTS（整句发音在前端用番剧原声，见前端说明）。
4. **暴露统计 / 导出接口** —— `/api/stats`、`/api/export`，方便你把攒下来的数据拿去做统计或喂给 AI 分析（比如「我看过的番里最常出现哪些语法点 / 词」）。

只需要 Node ≥ 18（自带 `fetch`/`crypto`），没有任何 `npm install`。

---

## 启动

```bash
cd server
cp .env.example .env      # 填入你的 LLM_API_KEY
node server.mjs
# [llm-cache] listening on http://localhost:3939
```

然后在 asbplayer 里打开 **设置 → Misc → AI Grammar Analysis**，把
**Cache server URL** 填成 `http://localhost:3939`（部署后填你的服务器地址）。
填了之后，面板就走服务器缓存；留空则浏览器直连 LLM（只有内存缓存，刷新即失）。

## 配置（环境变量 / `.env`）

| 变量 | 默认 | 说明 |
|------|------|------|
| `LLM_API_KEY` | （必填） | OpenAI 兼容 Key，仅存服务端 |
| `LLM_BASE_URL` | `https://api.deepseek.com/v1` | 不要带 `/chat/completions` |
| `LLM_MODEL` | `deepseek-chat` | 模型名 |
| `LLM_TEMPERATURE` | `0.2` | 采样温度 |
| `PORT` | `3939` | 监听端口 |
| `DATA_DIR` | `./data` | 缓存落盘目录，文件按 `<番剧>/<集数>.json` 组织 |
| `PUBLIC_DIR` | 空 | 若填，用同源方式托管构建好的前端（`client/dist`），彻底免掉 CORS |
| `ALLOW_CLIENT_KEY` | `false` | 允许前端按请求覆盖 key/baseUrl/model（朋友各用各的 Key 时打开） |
| `VOICEVOX_URL` | `http://127.0.0.1:50021` | 本地 VOICEVOX 引擎地址；服务端在 `/api/tts` 代理它以规避浏览器 CORS |
| `VOICEVOX_SPEAKER` | `1` | 说话人 / 音色 id（`GET .../speakers` 可列出） |

## 接口

| 方法 / 路径 | 作用 |
|-------------|------|
| `GET /api/health` | 健康检查（缓存条数、模型、是否已配 Key、是否有 TTS） |
| `POST /api/analyze` | `{ line, force?, anime?, episode? }` → `{ analysis, cached, model }`；命中缓存直接返回，不调 LLM；带 anime/episode 时把命中结果也归档到该集 |
| `GET /api/episode?anime=…&episode=…` | 该集全部已缓存分析：`{ anime, episode, count, analyses: { 原文: 分析 } }`，前端打开文件时一次性载入 |
| `GET /api/library` | 番剧 / 集数清单（每集行数），用于浏览已攒下的内容 |
| `GET /api/tts?text=…&speaker=?` | VOICEVOX 合成的 WAV，可直接当 `<audio>` 的 src；引擎不可用时返回 502 |
| `GET /api/stats` | 聚合统计：语法点频次、JLPT 等级分布、高频词、番剧 / 集数等 |
| `GET /api/export?format=jsonl\|csv` | 导出全部记录，喂给 pandas / AI |

## 单词发音（VOICEVOX）

整句发音在前端直接播放**番剧原声**（最纯），单词发音走 [VOICEVOX](https://voicevox.hiroshiba.jp/)——
一个完全本地、免费、离线的日语神经 TTS 引擎。部署流程如下。

**1. 装引擎**（二选一）

- **桌面版 App（最省事）**：从 <https://voicevox.hiroshiba.jp/> 下载安装，启动后引擎即在跑。
- **只跑引擎 / 服务器 / Docker**：从
  <https://github.com/VOICEVOX/voicevox_engine/releases> 下载对应平台压缩包解压后

  ```bash
  ./run --host 127.0.0.1 --port 50021
  ```

  或直接用 Docker：

  ```bash
  docker run --rm -p '127.0.0.1:50021:50021' voicevox/voicevox_engine:cpu-latest
  ```

**2. 确认它能跑**

```bash
curl -s http://127.0.0.1:50021/version      # 返回版本号即正常
curl -s http://127.0.0.1:50021/speakers | head -c 2000   # 列出所有音色及其 id
```

**3. 告诉本服务**

在 `.env` 里填（`VOICEVOX_SPEAKER` 用上一步查到 id，不同引擎版本编号不同，**以 `/speakers` 返回为准**）：

```bash
VOICEVOX_URL=http://127.0.0.1:50021
VOICEVOX_SPEAKER=1
```

重启后 `GET /api/health` 的 `tts` 字段会变成 `true`。本服务用 `GET /api/tts` 代理引擎，
浏览器不直连、也就没有 CORS 问题。

**没装会怎样？** `/api/tts` 返回 502，前端自动回退到浏览器自带 TTS，不会报错打断你 —— 这一步是可选的。

> 前端侧更完整的说明（含音色选择、CDN 等）见仓库根目录的
> [`LLM_ANALYSIS_README.md`](../LLM_ANALYSIS_README.md)。

## 数据落盘

- `data/<番剧>/<集数>.json` —— 每集一个文件，`{ anime, episode, updatedAt, lines: { 哈希: 记录 } }`，重看这集时可整包载入。
- `data/analyses.jsonl` —— 追加日志，一行一条记录，方便 `jq` / pandas 流式统计。
- 内存里另有一份「哈希 → 记录」的全局索引做跨集去重，所以同一句台词即便出现在别的番也只分析一次。

一条记录：

```json
{ "hash": "…", "line": "次は", "analysis": { "translation": "…", "tokens": […], "grammar": […] },
  "model": "deepseek-chat", "anime": "Frieren", "episode": "28", "createdAt": "2026-09-16T…" }
```

## 部署（个人 / 小圈子）

最省心的一种：把前端构建好，用本服务同源托管，一个进程搞定，不用配 CORS。

```bash
# 1. 构建前端
corepack yarn workspace @project/client run buildFast
# 2. 让服务器同时托管前端 + 提供 /api
PUBLIC_DIR=../client/dist LLM_API_KEY=sk-… node server.mjs
# 打开 http://你的服务器:3939 即可用
```

生产环境建议再套一层带 HTTPS 的反向代理（Caddy / Nginx），并用 `systemd` 或 `pm2` 常驻。

## 做统计分析

```bash
# 拉全量数据
curl http://localhost:3939/api/export?format=jsonl > analyses.jsonl
# 或直接读 server/data/analyses.jsonl
```

有了 JSONL，就能很方便地让 AI 或 pandas 回答「这季番覆盖了哪些语法点、生词表、难度分布」之类的问题。
`/api/stats` 已经预先算好了一部分（`topGrammar` / `byLevel` / `topWords`）。

## 测试

```bash
node --test test.mjs   # 在 server/ 目录下
```
