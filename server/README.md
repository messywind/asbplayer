# 多用户 LLM / 番剧空间后端

该服务与构建后的 asbplayer 前端同源部署，提供：

- 邀请制用户名/密码登录；
- 管理员从前端生成、查看和停用邀请码；
- 每个用户独立的番剧空间、集数和分析归档；
- 相同字幕台词的全局分析复用；
- 每个用户独立填写 LLM API Key，使用 AES-256-GCM 加密落库；
- SQLite 持久化，视频和字幕文件始终留在用户浏览器本地；
- 可选 VOICEVOX 单词发音代理。

## 数据模型

数据库默认位于 `server/data/asbplayer.sqlite`，Docker 部署时位于 `/data/asbplayer.sqlite`。
SQLite 使用 WAL 模式，适合单实例的小型邀请制服务。

用户的番剧空间和集数关系完全隔离。`analyses` 表按规范化字幕文本的 SHA-256 全局去重，
`episode_analyses` 只保存某个用户集数对全局分析的引用。因此用户看不到他人的归档，重复台词又不会重复付费。

## 配置

复制 `server/.env.example` 为 `server/.env`。关键变量：

| 变量 | 说明 |
|------|------|
| `ADMIN_USERNAME` | 首次启动时创建的管理员用户名 |
| `ADMIN_PASSWORD` | 首次启动时创建管理员所用密码；数据库已有用户后不会覆盖 |
| `API_KEY_ENCRYPTION_SECRET` | 至少 32 字符；加密用户 API Key，部署后必须保持不变 |
| `SECURE_COOKIES` | 使用公网 HTTPS 时设为 `true` |
| `SESSION_DAYS` | 登录会话有效天数，默认 30 |
| `LLM_BASE_URL` | 所有用户统一使用的 OpenAI 兼容地址 |
| `LLM_MODEL` | 所有用户统一使用的模型 |
| `PORT` | HTTP 端口，默认 3939 |
| `DATA_DIR` | 数据目录 |
| `DATABASE_PATH` | SQLite 文件路径，默认 `<DATA_DIR>/asbplayer.sqlite` |
| `PUBLIC_DIR` | 构建后的前端目录；Docker 已自动配置 |

生成加密密钥：

```bash
openssl rand -hex 32
```

## 本地启动

需要 Node.js 22.17.1 或更新版本（使用内置 `node:sqlite`）：

```bash
cp server/.env.example server/.env
# 编辑 server/.env
node server/server.mjs
```

首次登录管理员账号后，在顶部账号按钮中：

1. 进入 **LLM API Key**，保存管理员自己的 Key；
2. 进入 **邀请码管理**，生成注册链接；
3. 用户通过注册链接注册，并填写各自的 Key。

## API 权限

`GET /api/health` 和登录/注册接口公开；其他 `/api/*` 均要求有效的 HttpOnly Session Cookie。
管理员邀请码接口还会检查 `admin` 角色。公网部署必须使用 HTTPS。

主要接口：

| 接口 | 作用 |
|------|------|
| `POST /api/auth/login` | 登录 |
| `POST /api/auth/register` | 使用邀请码注册 |
| `GET /api/auth/me` | 当前账号 |
| `PUT /api/account/api-key` | 加密保存当前用户 Key |
| `GET/POST /api/spaces` | 当前用户番剧空间 |
| `POST /api/episodes` | 创建或更新集数归档 |
| `GET /api/library` | 浏览当前用户的完整归档 |
| `POST /api/analyze` | 分析字幕或复用全局缓存 |
| `GET /api/episode?episodeId=…` | 当前用户某一集的分析 |
| `POST /api/admin/invites` | 管理员生成邀请码 |

## 测试

```bash
node --test server/test.mjs
```
