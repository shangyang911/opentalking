# 项目目录与开发

本文面向维护当前本地演示版的开发者。项目使用单仓库管理，前后端独立安装依赖与构建。

项目的统一说明和维护约定见仓库根目录的 `总纲.md`。

## 目录职责

- `frontend/src/app/`：工作台组装、顶栏、跨工作流的会话和媒体状态。
- `frontend/src/features/`：`conversation` 实时对话、`avatars` 形象及 light2d、`voices` 语音与克隆、`video-creation` 视频创作、`works` 作品库、`settings` 运行配置。
- `frontend/src/shared/`：HTTP 基础工具、公共类型、通用 UI 和样式；不反向依赖业务模块。
- `frontend/homepage/`：独立介绍站，保留自己的依赖、服务与构建入口。
- `backend/apps/api/modules/`：`conversation`、`avatars`、`voices`、`video_creation`、`works`、`system` 的路由、schema 与 service。
- `backend/apps/api/core/router.py`：供 API 与 unified 共同注册业务路由。
- `backend/apps/unified/`、`backend/apps/cli/`：运行及命令行入口。
- `backend/opentalking/`：配置、形象、声音、providers、模型、流水线和 worker 引擎；Python 包名仍是 `opentalking`。
- `backend/configs/`、`backend/tests/`：后端配置、API/单元测试及共享 fixtures。
- `deploy/`、`scripts/`、`docs/`：部署资源、项目级脚本和双语文档。

各业务的 API 请求函数和类型放在自己的 `api.ts`，通用 HTTP 请求放在 `frontend/src/shared/api/client.ts`。跨工作流的状态仍由 app 协调，浏览器录制、WebRTC、麦克风及字幕的生命周期保持一致。

## 安装与启动

在仓库根目录执行（Linux、macOS 或 WSL）：

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e './backend[dev]'
cd frontend
npm ci
cd ..
bash scripts/start_unified.sh --mock
```

已有 `.env` 时直接保留；首次安装才从 `.env.example` 复制。浏览器默认地址为 `http://localhost:5173`，后端默认为 `8000`。

在 WSL 中从 `/mnt/<盘符>/` 运行前端开发服务时，Vite 自动使用 500 毫秒轮询监听文件，确保 Windows 编辑器修改源码后热更新生效。生产预览仍需重新构建；修改本地运行中的功能后，应核对实际页面版本，必要时沿用原端口和配置主动重启并验证。

真实本地 QuickTalk 仍使用：

```bash
bash scripts/start_unified.sh --backend local --model quicktalk --api-port 8210 --web-port 5173
```

也可在 backend 目录安装依赖并单独启动服务：

```bash
cd backend
pip install -e '.[dev]'
opentalking-unified
```

## 配置与数据

`.env`、`examples/avatars/`、`data/`、`output/` 保留仓库根目录。默认 YAML 为 `backend/configs/default.yaml`。路径工具 `backend/opentalking/core/paths.py` 让根目录与 backend 目录启动使用相同的配置及资源。

`OPENTALKING_ENV_FILE`、`OPENTALKING_CONFIG_FILE`、模型及资源路径等显式环境变量继续生效；本地资源相对路径以项目根目录为基准，绝对路径保留。API URL、静态资源 URL 和浏览器 localStorage key 保持原样。

## 验证

在仓库根目录执行：

```bash
pytest backend/tests frontend/tests/regression frontend/homepage/tests
ruff check --config backend/pyproject.toml backend/opentalking/core backend/opentalking/events backend/opentalking/avatar backend/apps backend/tests
python scripts/docs/check_i18n_structure.py
python scripts/docs/check_api_docs.py
cd frontend
npm test
npm run typecheck
npm run build
cd homepage
npm run build
```

历史上游界面断言保留在 `frontend/tests/upstream/`，覆盖本演示版此前已移除的知识库、记忆、场景管理等功能及旧配置 UI，不属于当前演示版默认回归范围；详见 `frontend/tests/README.md`。

部署资源和入口见仓库的 `deploy/README.md`，根目录使用 `bash scripts/compose.sh up --build`。
