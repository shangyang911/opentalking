# API 接口

OpenTalking 暴露由 `backend/apps/api/modules/` 定义的 REST、Server-Sent Events 与 WebSocket
接口，分组如下：

| 分组 | 用途 | 文档 |
|------|------|------|
| 健康检查与模型 | 存活探针、队列检视、能力发现。 | [健康检查与模型](health.md) |
| 数字人形象 | Avatar bundle 目录与自定义形象上传。 | [数字人形象](avatars.md) |
| 会话 | 会话生命周期、对话交互、WebRTC 信令。 | [会话](sessions.md) |
| 流媒体输出 | RTMPS/WHIP 推送、WHEP 接收与本地测试 harness。 | [流媒体输出](streaming.md) |
| 视频创作分片 RTMPS | 视频生成过程中分片发布 RTMPS 的架构、实施步骤与验收。 | [视频创作分片 RTMPS](video-creation-rtmps-execution.md) |
| TTS 与音色 | 一次性 TTS 预览与复刻音色管理。 | [TTS 与音色](tts-and-voices.md) |
| 事件与流式接口 | Server-Sent Events 流与音频 WebSocket 协议。 | [事件与流式接口](events.md) |

## Base URL 与鉴权

默认 Base URL 为 `http://localhost:8000`，前端通常通过同源 `/api` 代理访问。
默认启用手机验证码与管理员账号认证，使用 HttpOnly Cookie 保持会话。
`/auth/status`、验证码发送与登录接口及 `/healthz` 可公开访问；其余业务接口要求登录，
管理员接口及运行配置修改还会验证管理员角色。详见[账号配置](../../usage/authentication.md)。

`OPENTALKING_CORS_ORIGINS` 环境变量控制允许的跨域 origin，详见
[配置 §3](../../tutorials/configuration.md#3)。

## 请求与响应约定

除特别说明外，请求与响应体格式为 `application/json`。Avatar 与音色复刻端点使用
multipart 上传（`multipart/form-data`）。

- 成功响应返回 HTTP `200` 与 JSON 体。
- 校验失败返回 HTTP `400`，payload 为 `{"detail": "..."}`。
- 资源缺失返回 HTTP `404`。
- 上游服务（DashScope、OmniRT）的鉴权与授权错误转换为 HTTP `502`，原始错误文本置于 `detail` 字段。
- 服务端错误返回 HTTP `500`，message 为通用提示；具体异常已记录到日志。

标识符格式：

- `session_id` —— 会话创建时分配的 UUID4 字符串。
- `avatar_id` —— slug 格式字符串（字母、数字、连字符、下划线、中文字符），由 avatar 的 `manifest.json` 定义。
- 音色 `entry_id` —— SQLite 音色目录中的整型主键。
- `job_id` —— FlashTalk 离线 bundle 任务分配的 UUID4 字符串。

## 端点汇总

### 个人中心

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/account/profile` | 读取本人资料 |
| `PUT` | `/account/profile` | 修改昵称与签名 |
| `GET` | `/account/avatar` | 读取本人账户头像 |
| `POST` | `/account/avatar` | 上传并规范化账户头像 |
| `DELETE` | `/account/avatar` | 移除账户头像 |
| `POST` | `/account/password` | 验证当前密码并更新密码 |
| `GET` | `/billing/activity` | 本人最近 100 次任务结算 |

| 方法 | 路径 | 分组 |
|------|------|------|
| `GET` | `/auth/status` | 认证 |
| `POST` | `/auth/sms` | 认证 |
| `POST` | `/auth/login` | 认证 |
| `POST` | `/auth/password/login` | 认证 |
| `POST` | `/auth/admin/login` | 认证 |
| `GET` | `/auth/me` | 认证 |
| `POST` | `/auth/logout` | 认证 |
| `GET` | `/admin/overview` | 管理员 |
| `GET` | `/billing/me` | 会员与账本 |
| `GET` | `/billing/plans` | 会员与账本 |
| `GET` | `/billing/orders` | 会员与账本 |
| `POST` | `/billing/orders` | 会员与账本 |
| `POST` | `/billing/orders/{order_id}/cancel` | 会员与账本 |
| `POST` | `/billing/orders/{order_id}/demo-pay` | 演示付款，默认关闭 |
| `POST` | `/admin/billing/orders/{order_id}/demo-confirm` | 管理员确认演示开通，默认关闭 |
| `POST` | `/admin/billing/orders/{order_id}/demo-revoke` | 管理员撤销演示权益，默认关闭 |
| `GET` | `/billing/usage` | 会员与账本 |
| `GET` | `/admin/billing` | 会员与账本 |
| `PUT` | `/admin/billing/plans/{plan_id}` | 会员与账本 |
| `POST` | `/admin/billing/orders/{order_id}/confirm` | 会员与账本 |
| `POST` | `/admin/billing/orders/{order_id}/refund` | 会员与账本 |
| `POST` | `/admin/billing/gifts` | 会员与账本 |
| `GET` | `/health` | 健康检查与模型 |
| `GET` | `/healthz` | 健康检查与模型 |
| `GET` | `/queue/status` | 健康检查与模型 |
| `GET` | `/models` | 健康检查与模型 |
| `GET` | `/avatars` | 数字人形象 |
| `GET` | `/avatars/{avatar_id}` | 数字人形象 |
| `GET` | `/avatars/{avatar_id}/preview` | 数字人形象 |
| `POST` | `/avatars/custom` | 数字人形象 |
| `DELETE` | `/avatars/{avatar_id}` | 数字人形象 |
| `POST` | `/sessions` | 会话 |
| `POST` | `/sessions/customize` | 会话 |
| `POST` | `/sessions/customize/prompt` | 会话 |
| `POST` | `/sessions/customize/reference` | 会话 |
| `GET` | `/sessions/{session_id}` | 会话 |
| `POST` | `/sessions/{session_id}/start` | 会话 |
| `POST` | `/sessions/{session_id}/speak` | 会话 |
| `POST` | `/sessions/{session_id}/transcribe` | 会话 |
| `POST` | `/sessions/{session_id}/speak_audio` | 会话 |
| `POST` | `/sessions/{session_id}/speak_flashtalk_audio` | 会话 |
| `POST` | `/sessions/{session_id}/interrupt` | 会话 |
| `POST` | `/sessions/{session_id}/webrtc/offer` | 会话 |
| `POST` | `/sessions/{session_id}/flashtalk-recording/start` | 会话 |
| `POST` | `/sessions/{session_id}/flashtalk-recording/stop` | 会话 |
| `GET` | `/sessions/{session_id}/flashtalk-recording` | 会话 |
| `POST` | `/sessions/{session_id}/flashtalk-offline-bundle` | 会话 |
| `GET` | `/sessions/{session_id}/flashtalk-offline-bundle/{job_id}` | 会话 |
| `GET` | `/sessions/{session_id}/flashtalk-offline-bundle/{job_id}/download` | 会话 |
| `DELETE` | `/sessions/{session_id}` | 会话 |
| `WS` | `/sessions/{session_id}/speak_audio_stream` | 事件与流式接口 |
| `GET` | `/sessions/{session_id}/events` | 事件与流式接口 |
| `POST` | `/tts/preview` | TTS 与音色 |
| `GET` | `/voices` | TTS 与音色 |
| `POST` | `/voices/clone` | TTS 与音色 |
| `DELETE` | `/voices/{entry_id}` | TTS 与音色 |

## 典型请求顺序

完整的客户端交互通常遵循下述序列。

```mermaid
sequenceDiagram
    participant C as 客户端
    participant API as API

    C->>API: GET /models
    API-->>C: { models: [...] }

    C->>API: GET /avatars
    API-->>C: [ AvatarSummary, ... ]

    C->>API: POST /sessions
    API-->>C: { session_id, status: "created" }

    C->>API: POST /sessions/{id}/webrtc/offer
    API-->>C: { sdp: <answer>, type: "answer" }

    C->>API: GET /sessions/{id}/events (SSE)
    note over C,API: 流持续保持

    C->>API: POST /sessions/{id}/speak
    API-->>C: 200（播报事件经 SSE 推送）

    C->>API: DELETE /sessions/{id}
    API-->>C: 200
```

## OpenAPI 规范

FastAPI 自动生成完整的 OpenAPI 3.x 规范，可通过以下端点访问：

- 交互式文档（Swagger UI）：`<base>/docs`
- 替代交互式文档（ReDoc）：`<base>/redoc`
- 原始规范（JSON）：`<base>/openapi.json`

字段级精确类型与校验规则以 OpenAPI 规范为准。生成客户端 SDK 与编写集成测试时应以
规范为权威来源，本文档仅作为参考说明。

## 源文件

| 文件 | 路由 |
|------|------|
| `backend/apps/api/modules/system/health.py` | `/health`、`/healthz`、`/queue/status` |
| `backend/apps/api/modules/system/models.py` | `/models` |
| `backend/apps/api/modules/avatars/router.py` | `/avatars/*` |
| `backend/apps/api/modules/conversation/sessions.py` | `/sessions/*` |
| `backend/apps/api/modules/voices/preview.py` | `/tts/preview` |
| `backend/apps/api/modules/voices/router.py` | `/voices`、`/voices/clone`、`/voices/{entry_id}` |
| `backend/apps/api/modules/conversation/events.py` | `/sessions/{id}/events`（SSE） |
| `backend/apps/api/modules/conversation/schemas.py` | 会话的请求与响应模型。 |
| `backend/apps/api/modules/avatars/schemas.py` | `AvatarSummary` 响应模型。 |

## 当前业务模块补充接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/avatars/{avatar_id}/client-assets/{asset_path}` | Get Client Asset |
| `GET` | `/avatars/{avatar_id}/client-renderer` | Get Client Renderer |
| `PATCH` | `/avatars/{avatar_id}/person-mode` | Update Avatar Person Mode |
| `GET` | `/avatars/{avatar_id}/preview-video` | Get Preview Video |
| `POST` | `/avatars/{avatar_id}/prewarm` | Prewarm Avatar |
| `GET` | `/exports/videos` | List Export Videos |
| `POST` | `/exports/videos` | Upload Export Video |
| `DELETE` | `/exports/videos/{export_id}` | Delete Export Video |
| `GET` | `/exports/videos/{export_id}` | Get Export Video |
| `GET` | `/exports/videos/{export_id}/download` | Download Export Video |
| `GET` | `/runtime-config` | Get Runtime Config |
| `POST` | `/runtime-config/apply` | Apply Runtime Config |
| `GET` | `/runtime/status` | Runtime Status |
| `GET` | `/sessions/webrtc/ice-config` | Webrtc Ice Config |
| `POST` | `/sessions/{session_id}/fasterliveportrait-config` | Update Fasterliveportrait Config |
| `POST` | `/sessions/{session_id}/knowledge-bases` | Update Session Knowledge Bases |
| `POST` | `/tts/preview-duo-dialog` | Preview Duo Dialog Tts |
| `POST` | `/video-creation/jobs` | Create Video Creation Job |
| `DELETE` | `/video-creation/jobs/{job_id}` | Delete Video Creation Job |
| `GET` | `/video-creation/jobs/{job_id}` | Get Video Creation Job |
| `POST` | `/video-creation/jobs/{job_id}/stop` | Stop Video Creation Job |

## 知识库与明确记忆

详见[使用说明](../../usage/knowledge-memory.md)。

| 方法 | 路径 |
| --- | --- |
| `GET` | `/knowledge/bases` |
| `POST` | `/knowledge/bases` |
| `DELETE` | `/knowledge/bases/{kb_id}` |
| `GET` | `/knowledge/bases/{kb_id}/documents` |
| `POST` | `/knowledge/bases/{kb_id}/documents` |
| `DELETE` | `/knowledge/bases/{kb_id}/documents/{doc_id}` |
| `POST` | `/knowledge/bases/{kb_id}/documents/{doc_id}/retry` |
| `POST` | `/knowledge/bases/{kb_id}/query` |
| `GET` | `/knowledge/memories` |
| `POST` | `/knowledge/memories` |
| `PUT` | `/knowledge/memories/{memory_id}` |
| `DELETE` | `/knowledge/memories/{memory_id}` |
