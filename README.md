# 本地整修运行

使用 `.node-version` 固定的 Node 22.23.2；npm 使用随该 Node 分发的版本。根目录仅转发网站命令，采集脚本依赖暂保留。

安装：`npm ci`、`npm --prefix server ci`、`npm --prefix web-next ci`。
启动：`npm run dev:isolated`。自动启动真实 MongoDB 7.0.40 单节点副本集（首次需下载官方二进制），只监听回环，生成合成数据和临时密钥。退出后测试库销毁，不读取旧数据库配置。
访问 http://127.0.0.1:3000；合成账号 reader@example.test / Local-test-12345。不要把此账号或数据库用于生产。

独立 API 入口：显式设置 server/.env.example 中各变量后 `npm run server`；该入口不自动读取 .env，缺配置/数据库失败即退出。生产 autoIndex/autoCreate 关闭。

验证：`npm test`、`npm run typecheck`、`npm run lint`、`npm run build`；采集器 `npm run test:crawler`；浏览器 `npm run test:browser`（需先运行隔离服务和安装 Chrome）。构建需显式设置 INTERNAL_API_URL=http://127.0.0.1:5000/api、NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3000、NEXT_PUBLIC_EXTERNAL_SERVICES=disabled。

测试临时文件统一写入项目的 `.runtime/test-tmp/`，已由 `.gitignore` 排除。`tools/test-env.cjs` 为测试进程及子进程设置 TEMP/TMP/TMPDIR，不修改系统环境变量；MongoDB 测试库、浏览器临时配置和 Playwright 编译缓存均使用项目内路径。现有会创建临时数据的测试文件，以及 `server/dev.js`、`server/staging.js` 和目录基准测试入口会自动加载该配置。新增测试或临时验证脚本应先导入该文件，或在项目根目录执行 `node --require ./tools/test-env.cjs --test 路径`；临时目录仍须在测试完成后清理，不能依赖迁移路径防止积累。浏览器测试优先通过 `npm run test:browser` 启动，确保 Playwright 加载前已设置缓存路径。

本地默认关闭真实邮件、媒体、SEO、广告、统计；邮件默认由内存接收器捕获，SMTP协议测试另启回环接收器（不暴露公网）。测试库是真实 mongod，不是 Mongoose mock。单节点副本集支持事务但不是高可用部署。

当前是整修中的代码，安全、负载和恢复尚未完整验收，不能发布；详见 docs/整修执行记录.md。旧脚本不得对旧库试跑。
