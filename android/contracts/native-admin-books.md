# 管理员书籍列表

`GET /api/books?scope=admin&q=&orderBy=views&page=1&limit=20`

- 显式 `scope=admin` 先调用现有认证，再按实时用户角色验证 `admin`；匿名/失效令牌 401，普通账号（含作品作者）403。客户端隐藏按钮不能作为授权。
- 返回原有书籍数组与 `X-Total-Count`；筛选、分页、排序规则保持原有接口语义。包含所有作者的公开和私密书，始终排除软删除书。管理员将书设为私密后仍可从总编辑搜索和再次公开，不改变原作者。
- 成功与拒绝响应均 `Cache-Control: private, no-store`，`Vary: Authorization, Cookie`。无 `scope` 的原GET即使携带管理员身份仍仅返回公开书；不改变公开列表/推荐/搜索缓存边界。
- `scope` 其他值或重复值 400。后续资料、章节、可见性、删除仍调用各自原有权限检查接口。
- 原生 `WritingRepository.adminBooks` 固定发送此参数。浏览器若使用此范围也必须持有真实管理员登录态，不接受客户端声明角色或伪造来源。
