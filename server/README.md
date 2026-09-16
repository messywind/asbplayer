# LLM 缓存 / 代理服务器

一个**零依赖**的 Node 服务，给 asbplayer 的「AI 语法分析」功能做三件事：

1. **把 API Key 放在服务端** —— 浏览器永远看不到 Key，部署到服务器也不会有 CORS / Key 泄露问题。
2. **把每一句的分析结果持久化到文件** —— 按「字幕原文的哈希」缓存，同一句台词永远只分析（花钱）一次，跨刷新、跨设备、跨用户都复用。
3. **暴露统计 / 导出接口** —— `/api/stats`、`/api/export`，方便你把攒下来的数据拿去做统计或喂给 AI 分析（比如「我看过的番里最常出现哪些语法点 / 词」）。

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
| `DATA_DIR` | `./data` | 缓存落盘目录 |
| `PUBLIC_DIR` | 空 | 若填，用同源方式托管构建好的前端（`client/dist`），彻底免掉 CORS |
| `ALLOW_CLIENT_KEY` | `false` | 允许前端按请求覆盖 key/baseUrl/model（朋友各用各的 Key 时打开） |

## 接口

| 方法 / 路径 | 作用 |
|-------------|------|
| `GET /api/health` | 健康检查（缓存条数、模型、是否已配 Key） |
| `POST /api/analyze` | `{ line, force? }` → `{ analysis, cached, model }`；命中缓存直接返回，不调 LLM |
| `GET /api/stats` | 聚合统计：语法点频次、JLPT 等级分布、高频词等 |
| `GET /api/export?format=jsonl\|csv` | 导出全部记录，喂给 pandas / AI |

## 数据落盘

- `data/analyses.json` —— 权威存储，`{ 哈希: 记录 }`，去重。
- `data/analyses.jsonl` —— 追加日志，一行一条记录，方便 `jq` / pandas 流式统计。

一条记录：

```json
{ "hash": "…", "line": "次は", "analysis": { "translation": "…", "tokens": […], "grammar": […] },
  "model": "deepseek-chat", "createdAt": "2026-09-16T…" }
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
node --test        # 在 server/ 目录下，8 个用例
```
