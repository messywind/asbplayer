<p align="center">
    <img src="https://raw.githubusercontent.com/asbplayer/asbplayer/main/extension/public/icon/icon128.png" width="75" height="75" style="border-radius: 16px" alt="asbplayer" />
</p>

<div align="center">

[![GitHub License](https://img.shields.io/github/license/asbplayer/asbplayer)](https://github.com/asbplayer/asbplayer?tab=MIT-1-ov-file)

</div>

# asbplayer · 学习增强分支（AI 语法分析 + 多用户后端）

> 本仓库是 [asbplayer](https://github.com/asbplayer/asbplayer) 的一个**学习向分支**。在原版“字幕媒体播放器 + Anki 制卡工具”的基础上，面向**中文母语的日语学习者**，新增了一整套 **AI 语法分析**、**邀请制多用户后端**、**单词发音（VOICEVOX）** 与 **MKV 无声修复** 能力。原版的所有功能（Yomitan 悬停查词、音高标注、生词标记、Anki 导出、流媒体字幕挂载等）继续保留。

看番剧时，对**当前字幕行**实时给出：**中文整句翻译 + 逐词词法（假名 / 罗马音 / 词性 / 词义）+ 语法点讲解**，并支持**点词发音**与**整句原声回放**。分析由任意 **OpenAI 兼容**接口驱动（OpenAI、DeepSeek、Moonshot、本地 Ollama 均可），视频与字幕文件**始终留在浏览器本地**，不会上传。

---

## 相较原版新增了什么

- **AI 语法分析面板**：整句翻译、逐词词法、语法点讲解（含大致 JLPT 等级）、口语/惯用法提示，支持「一键解析整集」并按字幕原文缓存，播放时不重复请求。
- **邀请制多用户后端**（`server/`）：零依赖 Node 服务，与前端同源部署。管理员生成邀请码、管理账号；每个用户独立填写 LLM API Key，使用 **AES-256-GCM** 加密落库；番剧空间、集数归档按账号隔离；相同字幕分析按文本哈希**全局复用**，避免重复付费。
- **单词发音**：后端代理本地 [VOICEVOX](https://voicevox.hiroshiba.jp/) 引擎，自然的日语神经 TTS；未部署时自动回退到浏览器自带 TTS。整句发音则直接截取当前视频的**番剧原声**。
- **MKV 无声修复**：用浏览器内的 ffmpeg.wasm 把 AC-3 / E-AC-3 / DTS 等 Chromium 无法解码的音轨转成可播放的 AAC，与画面同步播放。
- **数据可导出**：`GET /api/library`、`GET /api/export?format=jsonl|csv` 等接口可直接拿去做统计或喂给 AI。

详细的功能说明见 [`LLM_ANALYSIS_README.md`](LLM_ANALYSIS_README.md)；后端接口与权限见 [`server/README.md`](server/README.md)；产品与设计说明见 [`PRODUCT.md`](PRODUCT.md) 与 [`DESIGN.md`](DESIGN.md)。

## 仓库结构

| 目录        | 说明                                                                 |
| ----------- | -------------------------------------------------------------------- |
| `client/`   | 浏览器版 Web 应用（Vite + React）。开发端口 **3000**，`/api` 代理到后端。 |
| `common/`   | 前端共享代码，含 `common/llm-analysis/`（与 UI 解耦的分析引擎）。     |
| `extension/`| 浏览器扩展（Chrome / Firefox），用于在流媒体上挂载字幕。             |
| `server/`   | 多用户 LLM / 番剧空间后端（Node + `node:sqlite`）。HTTP 端口 **3939**。 |

## 环境要求

- **Node.js 22.17.1 或更新**（后端使用内置 `node:sqlite`，务必满足此版本）。
- **Yarn 3.2.0**（仓库已内置，通过 corepack 使用，无需全局安装）。

本仓库使用 Yarn 3（Berry），可执行文件锁定在 `.yarn/releases/yarn-3.2.0.cjs`。若系统没有 `yarn` 命令，先启用 corepack：

```bash
corepack enable        # 权限不足时可加 sudo
```

也可以不启用、直接调用内置版本：`node .yarn/releases/yarn-3.2.0.cjs <命令>`。

---

## 本地开发部署（前端 + 后端）

### 1. 安装依赖

在仓库根目录执行一次：

```bash
corepack yarn install
```

### 2. 配置并启动后端（端口 3939）

```bash
cp server/.env.example server/.env
# 编辑 server/.env，至少设置管理员账号与加密密钥
node server/server.mjs
```

`server/.env` 关键变量：

| 变量                        | 说明                                                           |
| --------------------------- | -------------------------------------------------------------- |
| `ADMIN_USERNAME`            | 首次启动时创建的管理员用户名。                                 |
| `ADMIN_PASSWORD`            | 首次启动创建管理员所用密码；**数据库已有用户后不会覆盖**。     |
| `API_KEY_ENCRYPTION_SECRET` | 至少 32 字符，用于加密用户 API Key，**部署后不要再改动**。     |
| `LLM_BASE_URL` / `LLM_MODEL`| 全体用户统一使用的 OpenAI 兼容地址与模型（默认 DeepSeek）。    |
| `PORT`                      | HTTP 端口，默认 `3939`。                                       |
| `SECURE_COOKIES`            | 公网 HTTPS 部署时设为 `true`。                                 |

生成加密密钥：`openssl rand -hex 32`

> 后端只依赖 Node 内置模块，`node server/server.mjs` 即可运行，无需额外安装。首次启动会用 `.env` 里的账号自举出管理员，日志会打印 `bootstrapped administrator`。

### 3. 启动前端（端口 3000）

另开一个终端，在仓库根目录：

```bash
corepack yarn workspace @project/client start
```

Vite 会把 `/api` 请求代理到 `http://127.0.0.1:3939` 的后端。启动后浏览器打开 **http://localhost:3000** ，用 `server/.env` 里设置的管理员账号登录即可。

> 若没有 `yarn` 命令：用 `node .yarn/releases/yarn-3.2.0.cjs workspace @project/client start`，或直接 `cd client && node ../node_modules/vite/bin/vite.js --port 3000`。

### 4. 登录后的初始化

1. 右上角账号菜单 → **LLM API Key**：保存管理员自己的 Key。
2. **邀请码管理**：生成注册链接，发给其他用户。
3. 用户通过注册链接注册，并各自填写自己的 API Key。

前端的 LLM 相关设置也可在 **设置 → Misc → AI Grammar Analysis** 中调整（启用面板、缓存服务器地址等）。多用户模式下登录后会自动使用同源后端，无需再单独填写缓存服务器地址。

### 5. 单词发音（VOICEVOX，可选）

VOICEVOX 是完全本地、免费的日语语音合成引擎，默认监听 `127.0.0.1:50021`。安装桌面版或用 Docker 跑引擎后，在 `server/.env` 里填：

```dotenv
VOICEVOX_URL=http://127.0.0.1:50021
VOICEVOX_SPEAKER=1
```

重启后端后 `GET /api/health` 会出现 `tts: true`。未部署时点词会自动回退到浏览器 TTS。详见 [`LLM_ANALYSIS_README.md`](LLM_ANALYSIS_README.md#发音整句原声--单词-voicevox)。

---

## Docker 部署（生产 / 同源）

镜像同时包含构建后的前端与后端，Node 服务在同源提供 SPA 与 `/api/*`，数据存放在 `asbplayer_data` 卷中的 SQLite。

```bash
git clone --branch feature/llm-analysis-full git@github.com:messywind/asbplayer.git
cd asbplayer
cp server/.env.example server/.env
# 编辑 server/.env：设置 ADMIN_USERNAME / ADMIN_PASSWORD / API_KEY_ENCRYPTION_SECRET，公网部署设 SECURE_COOKIES=true

VITE_APP_GIT_COMMIT="$(git rev-parse --short HEAD)" docker compose up -d --build
docker compose logs -f asbplayer
```

默认只监听 `127.0.0.1:3939`，建议在前面套 Caddy / Nginx 做 HTTPS 反代。需直接对外暴露时用 `ASBPLAYER_BIND_ADDRESS=0.0.0.0 docker compose up -d`（不推荐裸奔，因为 API 会消耗配置账号的 LLM 额度）。更新、备份与恢复见 [`DOCKER.md`](DOCKER.md)。

---

## 数据与隐私

- 视频与字幕文件**始终留在用户浏览器本地**，不会上传到服务器。
- 账号、番剧空间、集数归档与全局分析缓存存于 SQLite（本地 `server/data/asbplayer.sqlite`，Docker 为 `/data/asbplayer.sqlite`）。
- 每个用户的 LLM API Key 使用 AES-256-GCM 加密保存，后端**不会**把明文返回浏览器。
- 成员目录只公开番剧空间名称与聚合数量，不暴露媒体文件名、字幕原文、分析内容或 API Key。

## 常见问题

**MKV 有画面但完全没声音**：多为番剧 `.mkv` 使用了 AC-3 / E-AC-3 / DTS 等 Chromium 无内置解码器的音轨。播放器左上角会出现 **「Repair audio」** 提示条，点击后用浏览器内的 ffmpeg.wasm 把音轨转成 AAC 并与画面同步播放。详见 [`LLM_ANALYSIS_README.md`](LLM_ANALYSIS_README.md#mkv-没声音音频编码不支持)。

## 测试

```bash
node --test server/test.mjs                          # 后端
corepack yarn workspace @project/common run test     # common（含 llm-analysis 单测）
corepack yarn run verify                              # 全量校验（loc / 类型 / 测试 / lint / 格式）
```

## 构建扩展（AMO 源码审阅参考）

```
node 22.17.1
yarn 3.2.0
```

```bash
yarn                                                                   # 安装依赖
yarn workspace @project/extension run wxt zip -b firefox               # Firefox 扩展
yarn workspace @project/extension run wxt zip -b firefox-android --mv2 # Firefox for Android
```

---

## 关于原版 asbplayer

**asbplayer** 是一款面向语言学习者的、基于浏览器的字幕媒体播放器与 Chrome 扩展，可以从带字幕的视频中制作高质量多媒体 Anki 卡片，在 Netflix、YouTube 等流媒体上挂载可选中字幕，配合 [Yomitan](https://yomitan.wiki/) 做悬停查词、音高与频率标注等。原版完整用户指南见 <https://docs.asbplayer.dev/docs/intro>，贡献指南见 [CONTRIBUTING.md](CONTRIBUTING.md)。

### 致谢

感谢所有赞助、贡献与翻译 asbplayer 的人们（原版名单）：

赞助者：[@vivekchoksi](https://www.github.com/vivekchoksi), [@nzarbayezid](https://www.github.com/nzarbayezid), [@ManuJapan](https://www.github.com/ManuJapan), AdamM, realgoodsmiley, Alex, [@m4eko](https://github.com/m4eko), Simon, Attenius, medyas, [@zaerald](https://github.com/zaerald), Suna, [@tony7253](https://github.com/tony7253), [@voothi](https://github.com/voothi), kibo, [@genericdave](https://github.com/genericdave), Daniel, Cristian, Joey Potter, [@InteractiveNinja](https://github.com/InteractiveNinja), [@agloo](https://github.com/agloo), [@Venous771](https://github.com/Venous771), [@Viterkim](https://github.com/Viterkim), 以及众多私下捐助者。

贡献者与译者名单较长，完整列表见[原版 README](https://github.com/asbplayer/asbplayer#thanks)。

如果你是非英语母语者并愿意帮忙翻译，欢迎加入 [Crowdin 项目](https://crowdin.com/project/asbplayer)。

## 许可

MIT，见 [LICENSE.md](LICENSE.md)。
