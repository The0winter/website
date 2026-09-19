# 本地整修运行

本地容量自动维护已接入根目录构建、开发和测试入口及采集器。`npm run storage:plan` 预览，`npm run storage:clean` 清理；只处理允许淘汰的构建、测试和缓存产物，保护正文、封面、续更状态和恢复资料。保留期限、容量预算及 `.storage-keep` 用法见 [本地容量与清理](docs/本地容量与清理.md)。

使用 `.node-version` 固定的 Node 22.23.2；npm 使用随该 Node 分发的版本。根目录仅转发网站命令，采集脚本依赖暂保留。

安装：`npm ci`、`npm --prefix server ci`、`npm --prefix web-next ci`。
启动：`npm run dev:isolated`。自动创建项目内的 SQLite 测试数据库，生成合成数据和临时密钥。退出后清理，不读取线上数据库配置，也不启动 MongoDB。
访问 http://127.0.0.1:3000；合成账号 reader@example.test / Local-test-12345。不要把此账号或数据库用于生产。

独立 API 入口：显式设置 server/.env.example 中各变量后 `npm run server`；该入口不自动读取 .env，缺配置/数据库失败即退出。生产 autoIndex/autoCreate 关闭。

验证：`npm test`、`npm run typecheck`、`npm run lint`、`npm run build`；采集器 `npm run test:crawler`；浏览器 `npm run test:browser`（需先运行隔离服务和安装 Chrome）。构建需显式设置 INTERNAL_API_URL=http://127.0.0.1:5000/api、NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3000、NEXT_PUBLIC_EXTERNAL_SERVICES=disabled。

测试临时文件统一写入项目的 `.runtime/test-tmp/`，已由 `.gitignore` 排除。`tools/test-env.cjs` 为测试进程及子进程设置 TEMP/TMP/TMPDIR，不修改系统环境变量；SQLite 测试库、浏览器临时配置和 Playwright 编译缓存均使用项目内路径。现有会创建临时数据的测试文件，以及 `server/dev.js`、`server/staging.js` 和目录基准测试入口会自动加载该配置。新增测试或临时验证脚本应先导入该文件，或在项目根目录执行 `node --require ./tools/test-env.cjs --test 路径`；临时目录仍须在测试完成后清理，不能依赖迁移路径防止积累。浏览器测试优先通过 `npm run test:browser` 启动，确保 Playwright 加载前已设置缓存路径。

本地默认关闭真实邮件、媒体、SEO、广告、统计；邮件默认由内存接收器捕获，SMTP协议测试另启回环接收器（不暴露公网）。测试通过与 D1 共用的 SQL 适配层读写真实 SQLite，另有 VPS 上的真实 D1/R2 演练。

网站运行在现有 VPS，业务数据使用 D1 和 R2；连接、迁移、备份及回滚要求见 [Cloudflare 数据存储](docs/Cloudflare数据存储.md)。旧 MongoDB 脚本仅保留用于历史迁移，不得对现网试跑。
