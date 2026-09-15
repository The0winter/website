# 数据存储与维护

网站前端和 Node API 继续运行在现有 VPS。账号、会话、书架、阅读进度、评论、作品资料和正文引用存放在 Cloudflare D1；章节正文、现代创作草稿和封面使用 R2。少量旧格式草稿的文字随原记录保存在 D1，仍可通过网站恢复。

- D1 数据库：`jiutian-app`，ID `33703292-a2dd-4352-a301-666e7a0a2956`。
- 私有 R2：`jiutian-chapters`，正文 `chapters/sha256/`、草稿 `drafts/`、数据库备份 `backups/database/`。
- 公共封面 R2：`jiutian-covers`。数据库备份绝不能放入此桶。

## 连接与本地开发

运行入口通过 `server/database/index.js` 读取 `DATABASE_URL`。生产 URL 格式为 `d1://账号ID/数据库ID`；D1 令牌只放在 VPS `/etc/test1/d1.env`，权限为 root 0600，由 systemd 注入进程。令牌限制为当前 Cloudflare 账号的 D1 读写和现有 VPS 出口 IP。不得复制到前端、Git、日志或本地 `.env`。

本地 `npm run dev:isolated` 和常规后端测试使用 SQLite，文件由 `TestDatabase` 创建在项目 `.runtime/test-tmp/test1-sqlite-*`，退出时清理。不会启动 MongoDB 或生成预分配的大型日志。旧的 MongoDB 备份恢复工具只供历史迁移取证，不能用于当前线上库。

保留 Mongoose 的模型校验、字段类型及已有接口，底层换为 D1 文档表。每个集合有 `id`、JSON `document`、`revision`；原有 ID、日期、关系和唯一索引保留。它是针对本站查询与事务实现的适配层，不是完整的 MongoDB 替代驱动。新增查询运算符或聚合前必须补充行为测试。

查询尽量使用 SQL 索引、数据库投影与分页；特殊数组、正则及复杂聚合在 VPS 上处理。事务用全库版本检查和 D1 原子批次提交，冲突会重新执行回调。回调中的外部操作必须保持幂等。网络中断后根据提交收据确认结果，不盲目重放写入。大于 SQL 文本限制的旧草稿使用参数绑定暂存，并由原子提交消费。

生产通过 D1 REST API 连接。Cloudflare 通用 API 的请求限额仍然适用；并行读请求会合并，但这并不取消服务限额。流量明显增加时，应把数据库访问入口改为受认证的 D1 Worker 网关；网站本身仍可留在 VPS。计费和限制以 [D1 定价](https://developers.cloudflare.com/d1/platform/pricing/) 和 [API 限额](https://developers.cloudflare.com/fundamentals/api/reference/limits/) 为准。

## 备份、校验与切换

通用工具为 `infra/cloudflare-data.mjs`，在 VPS 使用 Node 22 并加载 `/etc/test1/api.env` 和 `/etc/test1/d1.env`。工具只输出数量、哈希和操作状态，不输出业务文档或凭据。

切换完成后，当前 `api.env` 已移除 `MONGO_URI`。只有需要重新核对历史 MongoDB 源时，才为 `snapshot-mongo` 加载保留的 `/etc/test1/api.env.before-d1`；不要把这个旧配置恢复给正在运行的网站。每日 D1 备份的成功清单在 `/var/lib/test1-cloudflare-backup/latest.json`。

1. `snapshot-mongo`：对 MongoDB 做一致性快照，保留原始 BSON EJSON、ID 和日期；压缩包存到私有 R2，并下载回读校验 SHA-256。迁移源副本保存在 `/srv/test1/backups/cloudflare/`，不删除 MongoDB。
2. `import --file=绝对快照路径 --inactive-target=数据库ID --chapter-bodies=r2`：只允许 `WRITE_MODE=readonly` 且明确指定的未启用目标。按完整快照对齐目标记录，包含删除目标中源已不存在的记录；绝不能对正在提供写入的数据库执行。重复运行仅改动有差异的记录。旧内嵌章节正文转存 R2 后，每个集合再次逐条比对。
3. `verify --file=绝对快照路径 --chapter-bodies=r2`：独立回读、核对记录数量和全部文档。无该参数时按原快照原样比对。
4. `backup`：对 D1 的所有业务集合做版本一致的快照，私有 R2 上传成功并回读校验后才写成功清单。`test1-cloudflare-backup.timer` 每日执行，VPS 仅留下小型清单；正文和图片已在 R2，不在每次数据库备份中重复打包。

最终切换前先暂停写入及清理任务，再重新快照和同步增量。只读验收通过后启用写入。切换后不能直接启用仍连接旧 MongoDB 的代码回滚，否则会看到旧数据并产生分叉；回滚版本必须支持同一个 D1 库。原 MongoDB 暂保留为迁移源备份，后续退役须单独核对。

`/health/ready` 实测数据库连接；受监控密钥保护的 `/health/metrics` 包含后端类型和请求/读写行数。会话、验证码等 TTL 记录每 15 分钟按原过期索引清理，提交收据与未消费的大字段暂存保留至少一天。创作回收站和 R2 对象清理仍遵循各自的恢复期限，不用通用 TTL 绕过。

封面继续用 `infra/upload-cover.mjs`；它会读取当前 D1 配置，无需新建单本书脚本。

## 后台读取额度回归

2026-09-15 排查发现，写作回收站每分钟检查一次过期章节，原来的日期范围查询未使用 D1 部分索引；13,999 条正常章节也会每分钟被完整扫描，约六小时即可耗尽免费版每日 500 万行读取额度。草稿清理存在相同的查询形式。

`purgeExpiredWritingTrash` 的过期条件必须同时包含 `$exists: true` 与 `$lte: now`，使生成的 SQL 明确满足稀疏索引的存在条件。清理期限、事务内到期复查和恢复规则保持原有行为。`server/tests/writing-trash-query.test.js` 在 14,000 条章节与 2,000 条草稿上检查实际查询计划，要求使用索引，防止无人使用时的全表扫描再次出现。

评估日活容量时，应计入目录总数、分卷边界、书架聚合、阅读上报及备份，不能将 500 万扫描行视为 500 万次页面访问。容量估算应注明每人阅读章节数、书籍长度和缓存条件；线上实测以 D1 返回的 `rows_read` / `rows_written` 为准。`/health/ready` 的常量查询成功也不能证明额度可用，部署验收仍须读取实际书籍、目录和正文。
