# 手机验证码登录与管理后台

用户入口为 `/login`，首次通过手机号验证码注册并设置密码，成功后进入 `/` 工作台；管理员入口为 `/admin`。管理员已登录时打开 `/login` 仍显示用户注册表单。两者使用同一个前端和后端服务，不需要增加监听端口。后端负责权限校验，修改网址或前端角色不能获得管理员权限。

## 手机号注册与密码登录

首次使用填写手机号、短信验证码、6～128 位密码及确认密码，点击“注册并登录”。手机号就是登录账号，无需另外设置用户名；密码以 scrypt 摘要保存，不存明文。

已注册用户点击表单下方“已注册？账号密码登录”，输入手机号与密码即可登录，无需短信。密码表单提供“还没有账号？手机号注册”返回入口；页面不再提供双标签或临时测试用户名登录。`bootstrap` 命令仅初始化管理员，不再接受 `--role user`。

`POST /auth/login` 接收 `phone`、`code`、`password`，验证短信后注册并登录。升级前已通过短信注册但尚无密码的用户，可在该表单验证手机号并设置首次密码，保留原用户 ID 与作品归属。已设置密码的手机号重复注册返回 409，不会覆盖原密码；目前此表单不提供忘记密码重置。

用户密码接口为 `POST /auth/password/login`，请求字段为 `phone`、`password`，不接受旧测试用户名。它沿用 MySQL 密码摘要、HttpOnly Cookie 会话和登录频控，同一 IP 或手机号每十五分钟最多尝试十次；只接受普通用户，无法取得管理员权限。管理员继续使用原来的 `/auth/admin/login` 和 `username`、`password`。

普通用户和管理员共用 `auth_users`、`auth_sessions` 等认证表，移除临时账号时应精确删除其用户行、关联会话和专属频控，不能删除这些正式功能必需的共用表。密码摘要字段同样用于正式手机号用户。

## 用户端与管理员端同时使用

同一浏览器可在两个标签页分别登录用户工作台与管理后台，登录或退出其中一端不会替换、撤销另一端的会话。用户端沿用 `opentalking_session`，后台使用独立的 `opentalking_admin_session`，两者均为 HttpOnly Cookie。跨标签页的登录状态通知也按两端分别同步。

`/admin/*` 接口使用管理员会话；`/auth/me`、`/auth/logout`、运行配置等共享接口通过 `X-Opentalking-Portal: admin` 选择后台会话，用户端发送 `user`。未指定时共享接口默认使用用户会话，不会自动借用管理员权限。后端仍验证会话令牌与真实账号角色；仅修改该请求头不能获得管理员权限。后台未登录时显示管理员登录表单，即使用户工作台已登录也不会显示权限拒绝页。

从旧版共用会话升级后，需要在管理后台重新登录一次，原有管理员账号密码不变。

## 配置数据库与短信

安装当前后端依赖，其中包含 `PyMySQL[rsa]`。在项目根目录 `.env` 中填写 `.env.example` 的 `OPENTALKING_MYSQL_*` 配置。数据库需提前建立，运行账号需要在该数据库中创建认证表及读写数据的权限。首次使用时只增加 `auth_` 前缀表，不清空原有业务数据。

后端在 WSL、MySQL 在 Windows 时，WSL 的 `localhost` 不指向 Windows。填写 Windows 在 WSL 中可达的主机地址，并使用只授权本应用数据库、限制连接来源的项目账号；WSL 地址变更后同步调整连接地址和账号来源授权。

### Spug 短信验证码（当前接入）

在 [Spug 控制台](https://push.spug.cc/console/verification/sms)的“短信验证码”中选择正文包含 `${number}分钟内有效` 的官方模板，点击“复制”取得完整调用 URL，再取最后一段模板编码。页面直接显示的 URL 可能带 `****`，不能使用脱敏文本或其可见前缀。在根目录私有 `.env` 填写：

```dotenv
OPENTALKING_SMS_PROVIDER=spug
OPENTALKING_SPUG_SMS_TEMPLATE_CODE=
```

第二项填模板编码，不填完整 URL。编码本身是调用凭证，不能写入前端、公开文档或提交。重启后端后，`GET /auth/status` 的 `sms_ready` 为 `true` 时，用户可在 `/login` 获取注册验证码。短信不可用时，已有密码的手机号用户仍可使用账号密码登录。

后端调用 `POST https://push.spug.cc/sms/<TEMPLATE_CODE>`，JSON 为 `to`（本次请求的单个手机号）、`code`（后端生成的六位验证码）、`number: "5"`。只在 HTTP 成功、响应 `code=200` 且含有效 `request_id` 时激活验证码。该响应表示请求已接受，最终投递结果请在 Spug“发送记录”中查看；后端日志仅记录 `request_id`，httpx 常规请求日志隐藏模板编码。

官方模板无需自行申请签名或等待模板审核；实际调用仍受平台实名状态、短信余额/额度及 IP 白名单限制。参见 [Spug 官方短信接口文档](https://push.spug.cc/guide/sms)。短信额度与微信推送额度独立，测试不会调用真实服务或消耗短信。

首次开通还需在 Spug“IP 白名单”添加后端实际出口公网 IP；空白名单会拒绝发送。控制台显示的是浏览器出口，可能与 WSL/服务器出口不同，应从发送进程所在环境核对。保存单个实际地址或受控网段即可生效；本地网络出口变化后需同步更新。

### 腾讯云兼容配置

设置 `OPENTALKING_SMS_PROVIDER=tencent` 可继续使用腾讯云，默认值也为 `tencent` 以兼容旧配置，不会在 Spug 失败时自动切换或重复发送。腾讯云国内短信需要实名认证、实名资质报备、审核通过的签名和验证码模板，以及短信应用的 SDK App ID。个人认证不能直接申请个人自用签名，需要符合腾讯云要求的企业授权资质。参考[签名审核标准](https://cloud.tencent.com/document/product/382/39022)和[发送短信 API](https://cloud.tencent.com/document/product/382/55981)。

填写以下后端变量，不能给变量加 `VITE_` 前缀，也不要将密钥写到浏览器代码：

```dotenv
OPENTALKING_TENCENT_SMS_SECRET_ID=
OPENTALKING_TENCENT_SMS_SECRET_KEY=
OPENTALKING_TENCENT_SMS_SDK_APP_ID=
OPENTALKING_TENCENT_SMS_SIGN_NAME=
OPENTALKING_TENCENT_SMS_TEMPLATE_ID=
OPENTALKING_TENCENT_SMS_REGION=ap-guangzhou
```

模板必须只有一个参数，即六位验证码，例如“您的验证码为 {1}，5 分钟内有效”。变量数量必须与已审核模板一致。未配置完成时，登录页明确显示短信服务未开通，不会生成可绕过认证的测试验证码。

## 初始化管理员

管理员不开放注册。激活项目 Python 环境后，从 `backend/` 运行：

```bash
python -m apps.api.modules.auth.bootstrap --username admin
```

命令会交互式要求输入 6～128 位密码并确认，密码不会出现在命令参数中。已有管理员不会被重复初始化覆盖。重置时加 `--reset-password`，该操作会撤销已有管理员会话。

也可在首次部署时通过 `OPENTALKING_ADMIN_USERNAME` 和 `OPENTALKING_ADMIN_PASSWORD` 初始化。账号存在后，这两个环境变量不再覆盖已有密码。没有默认密码。

## 用户与营收

用户提交手机验证码及密码后完成注册，后续使用手机号和密码登录同一账号。验证码有效期五分钟、最多五次错误、成功后不可重用；同一手机号每六十秒可获取一次、每二十四小时最多十次，同一 IP 每十分钟最多十次。`OPENTALKING_SMS_DAILY_LIMIT` 默认限制全站每二十四小时最多一百次发送尝试，失败尝试也计入频控。

登录通过 HttpOnly、SameSite=Lax Cookie 保持，令牌摘要存入 MySQL。默认会话二十四小时，可通过 `OPENTALKING_AUTH_SESSION_HOURS` 修改。用户作品、创作任务、声音、自定义形象及会话按账号隔离；系统形象可共享。历史演示资产保留，不会自动归给新用户。

后台提供注册用户概况、运行配置和会员订单账本。内测采用人工核实到账：管理员录入唯一收款流水号后发放权益，已确认到账与退款同步进入营收。套餐默认未上架，需管理员设价。详见[会员、额度与内测人工收款](membership.md)。

## 个人中心

用户点击工作台右上角头像进入 `/account`，可查看账户概览、会员与额度、订单记录、使用记录，编辑昵称（最多 30 字）、个性签名（最多 120 字）和账户头像。头像与数字人素材分别管理。打开个人中心保持工作台挂载，不打断已连接会话或浏览器录制；会话仍按连接时长结算。

头像支持 JPG、PNG、WebP，上传前可调整方形裁剪和缩放。服务端限制文件 2 MiB、1600 万像素，重新编码为 256×256 WebP 并移除元数据，保存在新增的 `auth_profiles` 表中。头像及资料仅本人登录后可读取，已有账号自动兼容默认资料。

账户安全页可验证当前密码后设置 6～128 字符新密码；每账号 15 分钟最多尝试 5 次。成功后其他登录会话失效，当前会话保留。换绑手机号和设备列表暂未提供。

接口为 `GET/PUT /account/profile`、`GET/POST/DELETE /account/avatar`、`POST /account/password`。全部根据登录态确定操作账号，不接受客户端指定用户 ID。

## 部署与测试

建议前端通过同源 `/api` 代理访问后端。上线 HTTPS 后设置 `OPENTALKING_AUTH_COOKIE_SECURE=true`。Vite 和 Nginx 保留浏览器 Host，供后端校验 Origin；跨站请求不能凭 Cookie 修改数据。

两个主要 Compose 配置固定 Nginx 的内部 IP，并通过 `FORWARDED_ALLOW_IPS` 只信任该代理和回环地址，以正确识别每个用户的 IP。默认网段为 `172.28.80.0/24`、代理为 `172.28.80.10`；如与本机已有网络冲突，同时配置 `OPENTALKING_PROXY_SUBNET` 和 `OPENTALKING_PROXY_IP`。容器访问宿主机 MySQL 时，不要使用容器自身的 `localhost`，应填写可访问的宿主机地址。

旧的纯本地演示可显式设置 `OPENTALKING_AUTH_ENABLED=false`；此时没有账号隔离，也不提供管理后台，不能用于公开部署。

认证集成测试必须使用独立测试库。连接配置可保存在根目录 `.env.test`（已忽略，不提交），也可通过 `OPENTALKING_TEST_MYSQL_HOST/PORT/USER/PASSWORD` 环境变量覆盖。指定 `OPENTALKING_TEST_MYSQL_DATABASE=opentalking_test` 后执行：

```bash
python -m pytest -c pytest.ini backend/tests/api/test_auth.py backend/tests/unit/test_auth_ownership.py
```

指定现有测试库时，库名必须以 `_test` 结尾；测试只创建并清理本次随机前缀的 `authtest_*` 表。测试账号只需在该测试库拥有建表、删表、外键和读写权限，不授予业务库权限。应用账号不需要 `DROP` 权限。

未指定现有测试库时，测试创建随机命名的 `opentalking_auth_test_*` 临时库并在结束后删除，需要另行授权创建和删除测试库的测试账号。短信 HTTP 调用使用测试替身，不会真实发送或消耗短信。真实投递需在配置所选短信服务后另行验证。
