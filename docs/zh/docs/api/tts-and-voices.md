# TTS 与专属声音

本地演示版提供 Edge、百炼 Qwen 试听，以及百炼 Qwen-Audio 专属声音管理。以下命令从仓库根目录执行；默认后端地址为 `http://localhost:8210`。

## `POST /tts/preview`

JSON 请求字段为 `text`（必填，1～1000 字）、`voice`、`tts_provider`、`tts_model`。返回 `audio/wav`。使用克隆音色时必须同时传入保存的 provider、模型和音色 ID，音色必须与复刻时绑定的模型一致。

```bash
curl -X POST http://localhost:8210/tts/preview \
  -H 'Content-Type: application/json' \
  -d '{"text":"你好，很高兴见到你。","tts_provider":"cosyvoice","tts_model":"qwen-audio-3.1-tts-flash","voice":"YOUR_VOICE_ID"}' \
  -o preview.wav
```

## `GET /voices`

返回当前单机演示用户保存的百炼克隆音色，格式为 `{"voices": [...]}`。每个条目包含 `id`、`user_id`、`provider`、`voice_id`、`display_label`、`target_model`、`source`。不返回系统音色。音色信息保存在 `OPENTALKING_SQLITE_PATH` 指定的 SQLite 中，默认 `./data/opentalking.sqlite3`。

## `POST /voices/clone`

`multipart/form-data` 字段：`audio` 为录音文件，`display_label` 为 1～40 字的名称。固定使用 `qwen-audio-3.1-tts-flash`，无需传 provider 或模型。

支持 WAV、MP3、M4A、WebM、OGG、MP4；文件最大 10 MB，时长 5～60 秒，推荐 10～20 秒清晰单人朗读。后端通过 FFmpeg 转为 24 kHz 单声道 WAV，以 Base64 直接上传百炼；等待音色就绪后保存记录。临时录音文件在转码后删除，无 `/voice-uploads` 公网接口。

```bash
curl -X POST http://localhost:8210/voices/clone \
  -F 'display_label=熟悉的声音' \
  -F 'audio=@sample.wav'
```

成功返回 `201` 和音色条目。错误：`400` 缺少密钥或录音无效；`413` 文件超限；`422` 必填字段或名称长度无效；`502` 百炼服务失败；`504` 上游超时。密钥沿用运行配置中保存的 `OPENTALKING_TTS_DASHSCOPE_API_KEY`，需具有北京地域模型权限。

## `DELETE /voices/{entry_id}`

删除百炼音色及本地记录，成功返回 `204`，无响应体。`404` 表示条目不存在或不是可删除的克隆音色；`502` 表示上游删除失败，本地记录保留以便重试。系统音色不会被删除。

创建音色免费，试听和合成按百炼账户额度及计费规则执行，不保证长期免费。详见[音色复刻说明](https://help.aliyun.com/zh/model-studio/voice-cloning-user-guide)与[模型价格](https://help.aliyun.com/zh/model-studio/model-pricing)。
