# Google SEO 恢复与发布

目标域名继续使用 `https://jiutianxiaoshuo.com`，首页标题保留“笔趣阁”。

## 生产配置

前端构建和运行环境使用同一份 `/etc/test1/web.env`：

```ini
NEXT_PUBLIC_SITE_URL=https://jiutianxiaoshuo.com
SITE_INDEXING=enabled
NEXT_PUBLIC_ANALYTICS_ENABLED=enabled
NEXT_PUBLIC_GOOGLE_ANALYTICS_ID=G-DWMPP2NRQ1
```

统计独立于 `NEXT_PUBLIC_EXTERNAL_SERVICES`，恢复 GA4 不会启用广告等其他集成。公开环境变量改变后必须重新构建。

生产 Nginx 不能在全站添加 `X-Robots-Tag: noindex, nofollow`。账户、书架、创作、登录、注册、站内搜索和仍在开发中的作者列表，由各自布局返回 noindex；robots.txt 允许抓取这些页面以读取该指令，私有数据仍由现有身份验证保护。API 与健康端点不列入抓取范围。

## 元数据、站点地图与旧链接

- 首页、排行榜、社区、书籍、章节、作者及讨论页面有各自的标题、描述和规范网址。书籍与章节的结构化数据保留，章节数不再被当作纸质书页数。
- `/sitemap.xml` 索引包含静态页面、作者和每本书的章节分区；每个书籍分区最多 1,000 章。移除未完成的 `/authorsList`；公共书籍 API 排除私有和删除内容。书籍分区 lastmod 来自真实更新时间，源服务失败返回 503 和 Retry-After。
- 旧链接不能根据相似书名或 ID 猜测重定向。只有能确认内容对应关系时才添加逐条永久重定向；缺失内容返回 404，不能一律转到首页。
- Next.js 在 loading 边界内可能先发送 200 再渲染 notFound。`web-next/proxy.ts` 在文档响应发送前检查书、章节、作者及帖子是否存在。章节通过目录元数据检查归属，不读取正文对象。RSC/预取继续使用现有导航路径；上游异常为可重试的 503，不冒充 404。
- 本轮旧库元数据读取被数据库权限拒绝，未扩大权限或改动旧库；没有据此生成未经验证的旧 ID 到新 ID 映射。

## 验收与部署

```sh
cd web-next
npm run typecheck
npx playwright test tests/seo-proxy.spec.ts --workers=1 --reporter=list
```

对已构建版本执行真实 HTTP 验收（可先在回环 3001 端口运行）：

```sh
node infra/check-seo.mjs http://127.0.0.1:3001 https://jiutianxiaoshuo.com --sitemaps
```

验收覆盖公开页/私有页的收录指令、GA4 植入、规范网址、目录与正文、不存在和归属错误的章节、作者/讨论 404，以及全部站点地图的唯一性、来源域名和公开路径。

部署应从线上兼容版本复制，并核对所有覆盖文件的基线、保留文件哈希和当前版本。不要直接用缺少线上未提交功能的 Git 检出覆盖服务器。`deployment-manifest.json` 必须绑定已提交并推送的 sourceCommit、release、previousRelease。

此前 2026-09-13 19:52 UTC 的 sitemap、排行榜、作者列表 502，与直接重启服务时的连接拒绝对应。本次采用预热切换：隔离版本先以同样的服务用户、沙箱和内存限制运行在回环 3001，HTTP 验收通过后，Nginx 临时转到 3001；再切换 current、重启 3000、确认就绪后把流量转回 3000。入口为 `infra/activate-web-release.py`，配置备份保存于 `/srv/test1/backups/seo-config-*`。

公网验收后使用 `--accept` 再次检查并写入 activatedAt，待旧请求完成后关闭临时服务，调用现有版本保留服务。失败可使用 `--rollback` 恢复兼容代码和本次配置备份，不回退数据库。不要在其他发布尚未验收或 current 已改变时继续切换。

## Google 后台

GA4 数据流使用原衡量 ID；页面加载和浏览器历史事件两项应保持开启，避免额外手工发送重复 page_view。通过真实浏览器访问与实时报告核验接收。

开放抓取后重新提交 `/sitemap.xml`，对首页、代表书籍及章节执行网址检查与请求编入索引，并对历史 5xx 发起修复验证。Google 的抓取、收录和排名更新是后续异步处理，提交成功不等于已经收录。
