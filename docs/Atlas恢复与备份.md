# Atlas 恢复与备份

采用当前网站代码接回 MongoDB Atlas，保留目录版本缓存、点击才加载目录、每小时回收站清理等优化。章节正文、云草稿、封面继续使用原 R2 对象；Atlas 存放账号、书籍、章节元数据、书架和进度。无需回滚网站功能，也无需逐本调整。

## 数据迁移

1. 停止旧 API 和写入任务，记录当前版本、配置与数据源；不启动已耗尽额度的 D1 服务。
2. 使用 Cloudflare 官方 D1 导出 API 获取最新完整 SQL，持续轮询到导出完成，下载并记录 SHA-256。签名下载地址和凭据只保存在服务器私有目录。
3. 离线转换：`python3 infra/d1-export-snapshot.py --sql=/private/latest.sql --output=/private/latest.json.gz`。转换仅操作内存 SQLite，不连接 D1；检查数据库完整性和文档 ID，保留日期、正文引用及原有索引定义。
4. 在原 Atlas 集群新建独立数据库，以私有环境文件设置 `DATABASE_URL` 和 `WRITE_MODE=readonly`。先运行 `node infra/atlas-data.mjs import --file=/private/latest.json.gz --inactive-target=目标数据库名`。
5. 导入只允许空库或与同一快照完全一致的部分导入。发现既有不同数据立即停止；不删除或覆盖原库。依据模型字段恢复 ObjectId，字符串 ID 保持字符串，不触发默认值、保存钩子或密码重算。
6. 逐条校验内容、BSON 类型及数量，恢复普通/唯一索引。TTL 过期索引暂缓创建，防止校验期间自动清理旧会话或去重记录。检查 R2 对象存在性，抽验每本书首末章和所有云草稿的正文哈希。
7. 保存一份验证过的 Atlas 快照到私有 R2，再运行 `activate-ttl`（参数同导入）。此后过期会话、验证码等由 MongoDB 正常清理，七天回收站仍由应用每小时处理。
8. 使用独立端口验证候选代码与兼容回滚版本，保持只读；通过后更新生产配置并切换版本。移除旧 `20-d1.conf` 服务覆盖，避免它覆盖新的连接地址。D1 源数据及迁移快照保留。

迁移只复制网站最新数据库，不会自动上传本地拾页书库。保持原书籍/章节 ID、密码散列、认证密钥和 R2 路径；有效登录会话、旧链接和阅读进度可继续使用。

## 备份与恢复

- `test1-atlas-backup.timer` 每日运行 `infra/atlas-data.mjs backup`。MongoDB 一致性事务快照同时记录规范化 JSON 与 BSON，压缩后上传私有 R2，并下载复核 SHA-256 才写入成功清单。
- 清单保存在 `/var/lib/test1-atlas-backup/latest.json`，归档位于私有桶 `backups/database/atlas-*.json.gz`。使用 Atlas 快照工具，不使用自建 MongoDB 的 `mongodump --oplog` 流程。
- 恢复时先从清单指定的私有 R2 对象下载，复核 SHA-256，再导入另一空库；校验和只读预览通过后才切换。不可把 `import` 直接指向正在服务的数据库。
- 备份不会复制正文大文件；正文使用不可变内容哈希地址，数据库快照保留原 R2 引用。草稿对象和封面沿用各自既有保留规则；较早数据库备份若引用已被正常清理的旧草稿对象，不能凭数据库快照还原该对象。
- 保持每日备份体积可在事务时间限制内读取；数据增长时需监测备份状态、容量与流量，不把失败清单当作成功。
- 2026-09-15 书库增至约 6.5 万章后，原先在内存中保存全部文档再一次性序列化的备份触发了 JavaScript 堆内存耗尽。Atlas 备份改为按游标流式编码、压缩到私有临时文件，再流式上传及 SHA-256 回读校验；保留原快照格式、BSON 类型、事务一致性和失败时不覆盖成功清单的规则。临时文件在完成或异常后清理，原有 384 MiB 服务内存限制保留。备份时长、磁盘和 Atlas 七天传输额度仍需监测。

## 检查

- `node --require ./tools/test-env.cjs --test server/tests/mongo-restore.test.js` 使用隔离的真实 MongoDB 副本集验证迁移、索引、备份和 R2 事务写入。
- `TEST_DATABASE_BACKEND=mongodb` 可让使用 `TestDatabase` 的业务测试改用真实 MongoDB；默认仍使用隔离 SQLite。测试二进制下载与数据目录均位于 `.runtime/test-tmp/`，可通过 `MONGOMS_SYSTEM_BINARY` 复用已有二进制。
- 线上验收必须包含原账号关联、书架/进度、目录、首末章正文、健康检查、数据库后端和备份读取验证。

Atlas Free 仍有容量、吞吐和传输限制；迁移不会自动升级套餐。[MongoDB 官方 Free 限制](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/)
