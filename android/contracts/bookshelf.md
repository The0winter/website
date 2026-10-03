# 书架同步 v1

`GET /api/v1/me/bookshelf/:bookId` 返回 `{revision,added,deviceId,updatedAt}`。旧收藏无修订记录时revision0，added由现有Bookmark确定。

`PUT` 同地址，请求 `{baseRevision,added:boolean,operationId,deviceId}`。参数格式与阅读进度相同。事务保留现有收藏里程碑统计行为，增加单书架项修订和删除墓碑。原网页新增/删除收藏也增加同一修订，响应字段保持兼容。

重试使用相同operationId，至少30天返回原响应；重复ID不同内容409 OPERATION_REUSED。旧baseRevision返回409 SHELF_CONFLICT以及current。旧离线设备不能直接取最新revision重放旧意图，否则会复活另一设备删除的书；保留冲突供用户选择本地或云端。用户明确再次收藏时才允许基于新revision写入。

GET旧library(tab=shelf)每项附shelfRevision/shelfAdded，避免逐书轮询。读取收藏列表不能删除本地尚待同步/冲突操作。账号切换隔离全部队列。

作品删除/私密后仍可取消本人收藏；添加不可用作品返回404。GET只读本人收藏状态，不泄漏书籍正文或他人书架。
