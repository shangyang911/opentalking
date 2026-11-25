# 阿里云 ECS 与 GitHub CI/CD

生产配置为 `deploy/compose.production.yml`：Nginx 前端、单进程 unified API 和私网 MySQL。数据库、作品、知识资料、音色和形象使用独立持久卷；运行配置目录单独挂载，管理员保存配置后不会随容器更新丢失。

## 发布流程

推送到 `main` 后，CI 先执行后端检查、前端测试与构建、Python 打包和文档检查。全部通过后，构建 CPU 生产镜像与前端镜像，上传到阿里云 ACR 私有镜像仓库；部署任务使用镜像 digest，通过 SSH 更新 ECS。PR 和其他分支不执行生产发布。

历史断言在 `.github/ci-known-failures.json` 中逐项列出。`python scripts/ci_pytest.py` 继续执行这些测试，并使用 strict xfail 报告预期失败；新增失败和意外通过都会阻止发布，修复后的条目需要从清单移除。直接运行 `pytest -c pytest.ini` 仍报告全部原始失败。

## 首次服务器配置

安装 Docker、Compose、Python 3、curl 和 flock。创建 `/srv/opentalking/shared/runtime`，仅允许运维账号访问。

将 `deploy/stack.env.example` 复制为 `/srv/opentalking/shared/stack.env`，填写两份独立随机数据库密码。将 `deploy/app.env.example` 复制为 `/srv/opentalking/shared/runtime/app.env`，填写实际云端服务配置。两份私有文件均设置权限 `600`。

在 ECS 同地域创建 ACR 镜像仓库 `opentalking-api` 和 `opentalking-web`。将 `deploy/registry.conf.example` 复制为 root 所有、权限 `600` 的 `/srv/opentalking/shared/registry.conf`，填写实际仓库域名、命名空间和登录名；此文件不含密码。GitHub 仓库变量 `ACR_REGISTRY` 与 `ACR_NAMESPACE` 必须与服务器配置一致，仓库 Secret `ACR_USERNAME` 与 `ACR_PASSWORD` 保存 Registry 专用凭证。ACR 个人版适合当前试用验证，无 SLA；正式生产按需要迁移企业版。

`OPENTALKING_ADMIN_USERNAME` 和 `OPENTALKING_ADMIN_PASSWORD` 可用于初始化管理员。不要将真实配置、私钥、数据库或用户媒体提交到 Git。

将 `scripts/deploy_ecs.sh` 安装为 root 所有的 `/usr/local/sbin/opentalking-deploy`。专用 SSH 用户仅通过 sudo 调用该脚本，不加入 Docker 用户组；私钥只保存在 GitHub 的 `production` 环境 Secret 中。服务器脚本只接受当前仓库的镜像 digest，并确认提交已经合入 `main`。

GitHub `production` 环境限制为 `main`，配置以下 Secret：

- `ECS_HOST`：服务器公网地址。
- `ECS_USER`：专用部署账号。
- `ECS_SSH_KEY`：部署账号的 SSH 私钥。
- `ECS_KNOWN_HOSTS`：通过可信渠道核对过的 SSH 主机公钥记录。

镜像认证使用 Registry 专用密码，通过 stdin 传输，在服务器临时目录中使用并清理，不写入持久 Docker 登录配置。凭证轮换时更新 `ACR_PASSWORD`，无需提交代码。

## 验收、恢复与备份

每次发布保存独立 Compose 和镜像清单。容器健康检查及同源 `/api/healthz` 成功后才更新 `/srv/opentalking/current`。更新失败时尝试恢复此前的 Compose 和镜像；数据库数据保留，数据库变更需要保持向后兼容。

服务器在部署锁内比较当前与候选提交，只接受相同或更新的 `main` 提交，避免较慢的旧流水线覆盖新版本。健康检查失败后的自动恢复使用已保存的上一版本，不受此更新顺序检查限制。

```bash
docker compose -p opentalking \
  --env-file /srv/opentalking/shared/stack.env \
  --env-file /srv/opentalking/current/images.env \
  -f /srv/opentalking/current/compose.yml ps
```

定期备份 MySQL 和应用持久卷，备份前确定一致性并实际验证恢复。发布会重建单机容器，需要等待正在进行的对话、录制和视频任务结束；此方案不承诺无停机发布。不要执行 `down -v`。

CPU 实例用于浏览器轻量数字人和云端语言、语音服务；QuickTalk 实时视频推理需要单独验证模型、权重和 GPU 环境。公网 HTTP IP 可用于访问页面和文字输入；麦克风采集需要浏览器信任的 HTTPS。WebRTC 音视频还需配置可达的 ICE/TURN 服务，开放对应的 TURN 和 UDP 中继端口。不要公开 MySQL 和 API 的内部端口。

Spug 短信需将服务器实际出口公网 IP 加入供应商白名单。代码部署不会自动迁移开发机的账号、订单和作品；数据迁移需单独备份和验证。
