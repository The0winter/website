# 原生认证合同 v1

Android 使用 HTTPS `https://jiutianxiaoshuo.com`。原生账号入口前缀 `/api/v1/auth`，普通业务继续复用 `/api` 路由及原有权限。网页 `/api/auth` 保留 Cookie、Origin 和 CSRF 语义。

## 请求与响应

原生请求不发送 `Origin`、`Cookie`、`Sec-Fetch-Site`，OkHttp 使用 `CookieJar.NO_COOKIES`。即使服务器读取防护返回 Cookie，App 也不保存或回传。带这些浏览器标识的请求不能取得原生 CSRF 例外。公共原生认证入口必须 POST JSON；禁止表单编码。服务端仅对精确公共认证路由或已经验证通过的原生 Bearer 跳过 CSRF，不影响其他网页写接口。

| 方法与路径 | 请求字段/认证 | 成功响应 |
| --- | --- | --- |
| POST `/login` | `email` 或 `username`、`password`、可选 `deviceName`；不带 Bearer | token 字段及 `user`、`profile` |
| POST `/send-code`（别名 `/register-code`） | `email`；不带 Bearer | `{message}` |
| POST `/signup`（别名 `/register`） | `email`、`username`、`password`、`code`、可选 `deviceName`；不带 Bearer | 201，token 字段及 `user`、`profile` |
| POST `/refresh` | `refreshToken`；不带 Bearer，尤其不能附过期 access token | 新 token 字段 |
| GET `/me` | Bearer | `{user,profile}` |
| POST `/change-password` | Bearer；`oldPassword`、`newPassword` | `{success:true}`，随后必须重新登录 |
| POST `/logout` | Bearer | `{success:true}`，当前设备立即撤销 |
| GET `/sessions` | Bearer | `{sessions:[{id,deviceName,createdAt,lastUsedAt,expiresAt,current}]}`，最近 100 个有效设备 |
| DELETE `/sessions/:sessionId` | Bearer；只能撤销本人设备 | `{success:true}`，可撤销当前设备；不存在/他人设备均 404 |

token 字段：`tokenType:"Bearer"`、`accessToken`、`expiresIn:600`、`accessExpiresAt`、`refreshToken`、`refreshExpiresAt`、`sessionId`。日期均 ISO 8601 UTC。访问普通业务使用 `Authorization: Bearer <accessToken>`，不能使用刷新令牌。账号字段沿用网页 `id`、`_id`、`username`、`email`、`avatar`、`profileTheme`、`avatarColor`、`role`、`created_at`；可选字段可缺省；`profile` 不含邮箱。

共享 `server/routes/auth.js` 的密码校验、注册事务、用户名保留、验证码消费、账号锁定和展示账号限制，不另写一套账号业务。密码至少 8 字符、UTF-8 最多 72 字节；设备名可选，非空且最多 80 字符，默认 Android。现有网页仅提供旧密码改密，没有邮箱找回密码能力；本合同不新增该业务。验证码 5 分钟有效、最多 5 次验证、发送间隔 60 秒、每邮箱每小时最多 5 次。错误登录 5 次锁定 1 小时，展示账号禁止登录。

## 会话与并发

访问 JWT 固定 HS256、独立 issuer/audience/type，有效 10 分钟。设备会话从登录起最长 30 天，刷新不延长绝对寿命。服务端每次认证读取设备会话与账号，不缓存权限或封禁状态。密码变化和管理员封禁/解封事务同时清理网页及原生会话；authVersion 作为竞态兜底，旧令牌不会恢复。

刷新令牌为高熵随机值及独立用途 HMAC，数据库只存 SHA-256 摘要，不存原令牌。每次刷新用数据库条件更新原子替换摘要；摘要不匹配但签名合法即证明旧令牌重放，立即撤销整个设备会话。随机伪造/篡改刷新令牌不会撤销合法会话。

**并发策略：严格单次使用。** 同一刷新令牌并发请求至多一个成功，另一个会撤销整个设备会话，刚返回的 token 也会失效。Android 必须按账号/设备 single-flight 刷新并原子保存整组新 token。刷新请求不能由 HTTP 自动重试；响应丢失、持久化失败或进程在轮换中死亡时清理本地凭据并要求重新登录。不能把同一旧刷新令牌继续重试当作恢复策略。服务端不保留可恢复的明文刷新令牌，也不提供宽限窗口。

退出先调用接口撤销，再清理本地凭据；access 过期时可以 single-flight 刷新后退出。离线退出只能清理本机，待用户在线从另一设备撤销该会话；不得假称服务端已撤销。

## 错误与限流

认证响应禁止缓存。错误 JSON 包含 `error`（可展示中文）和 `code`。主要码：`ACCESS_REQUIRED`、`ACCESS_INVALID`、`ACCESS_EXPIRED`、`SESSION_REVOKED`、`REFRESH_INVALID`、`REFRESH_REUSED`、`LOGIN_FAILED`、`ACCOUNT_UNAVAILABLE`、`NATIVE_CONTEXT_REQUIRED`、`JSON_REQUIRED`、`INVALID_INPUT`、`CONFLICT`、`SESSION_NOT_FOUND`、`RATE_LIMITED`。HTTP 401 中仅 `ACCESS_EXPIRED` 可以触发刷新；撤销/重放必须清理凭据并重新登录。服务器/维护或普通业务错误仍兼容现有 `{error}`，客户端必须允许缺少 code，不依赖中文解析。

原生认证每 IP 每分钟 20 次，另外受全局 API 限流、邮箱验证码限流和账号失败锁定约束。不要轮询 `/me`、`/sessions`。

## 验证与部署

`server/tests/native-auth.test.js` 用项目 `TestDatabase` 隔离数据库，覆盖 token 格式/过期、轮换/篡改/重放/并发、注销、设备归属、权限、封禁、原生与网页双向改密撤销、网页 CSRF、浏览器凭据隔离、共享注册及锁定、限流。可设 `TEST_DATABASE_BACKEND=mongodb` 复核 MongoDB；默认 SQLite 驱动和生产 MongoDB 使用相同 Mongoose 模型接口。

部署须创建 `NativeSession` 的 userId、查询组合和 expiresAt TTL 索引（正常建索引流程读取已加载模型）。过期判断始终在请求中执行，不依赖 TTL 清理及时性。新代码不改变既有 Session 字段或网页 Cookie 格式，可回滚到兼容旧版本；回滚期间 App 认证入口不可用。
