# 章内阅读位置 v1

正文 `/api/chapters/:id` 增加 `contentVersion`（原始 UTF-8 正文 SHA-256）与 `paragraphVersion:1`。旧字段及网页保持兼容。

段落严格按 `shared/reader-paragraphs.mjs`：按 CRLF/LF/CR 拆行，ECMAScript trim，移除空行，前三个非空行若与标题或“第N章 标题”去空白/括号后相同则去掉。逐 UTF-16 code unit 计算 FNV1a 和 DJB2 XOR 两个32位哈希，连接16位小写十六进制并附同哈希出现次数 `-1` 等。`charOffset` 以 UTF-16 code units 计数，不允许切开代理对；字体重排不改变锚点。

`GET /api/v1/me/reading-progress/:bookId` 返回 `revision,position,furthest,deleted,deviceId,updatedAt`。无记录 revision=0。position 含 `chapterId,chapterNumber,contentVersion,paragraphKey,paragraphIndex,charOffset`。作者私有或已删除作品不可通过本接口公开读取。

`PUT` 同一地址：`{baseRevision,operationId,deviceId,position:{chapterId,contentVersion,paragraphKey,charOffset}}`。`DELETE` 同一地址：`{baseRevision,operationId,deviceId}`。设备 ID 为8–100位字母数字/下划线/连字符，操作 ID 为16–100位同字符集，推荐 UUID。

- 事务比较 revision 并递增；409 `PROGRESS_CONFLICT` 携带最新 `current`。客户端保留本地位置及云端位置，让用户选择，不用旧设备上传时间覆盖新位置。
- 同用户 operationId 至少30天幂等，重复发送返回原响应；相同 ID 携带不同操作返回409 `OPERATION_REUSED`。收据过期后旧 baseRevision 仍不能覆盖新版本。
- 返回409 `CONTENT_CHANGED` 时刷新正文并按同段落键定位；键丢失则显示内容变更提示，并按段落序号/章首降级定位，再让用户确认续读位置。
- 最近位置与最远位置分别保存，允许重读早章。段落序号由服务器实际正文计算，不相信客户端章号/段落序号。
- 删除保留修订墓碑并移除旧 history；旧设备不可静默复活。明确继续阅读可基于新墓碑 revision 创建新位置。
- 成功写入同时更新旧 history，以兼容现有书架/最近阅读；旧网页换章亦递增相同修订。旧客户端访问同一章不会清除已同步的章内锚点。
- 需要现有网页 Cookie+CSRF 或已认证的原生 Bearer；不接受用户自行指定他人身份。

网页精确锚点上报和 Android 消费仍需端到端验收；后端合同通过不等于跨端功能通过。
