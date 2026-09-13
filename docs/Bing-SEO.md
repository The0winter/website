# 必应 SEO

沿用 `https://jiutianxiaoshuo.com/` 的必应站长资源、`BingSiteAuth.xml` 和已有 IndexNow 验证文件。首页 title 中的“笔趣阁”继续保留。

- robots.txt、页面规范网址、公开内容的 index 和账户页面的 noindex，与 Google 共用。
- 首页的手机和桌面布局共用一个 H1，避免搜索工具在 HTML 中检测到两个主标题。
- 必应站点地图提交 `https://jiutianxiaoshuo.com/sitemap.xml`，无需逐个手工提交章节分区。
- 使用 URL Inspection 的 Live URL 检查首页、书籍详情及章节；“可以收录”和“提交成功”均不代表已收录。

## IndexNow 批量恢复提交

站点地图是日常发现入口。恢复全站或批量修改公开内容后，可以使用以下命令通知 IndexNow 参与的搜索引擎：

```sh
node infra/submit-indexnow.mjs
node infra/submit-indexnow.mjs --apply
```

第一条只预览。第二条先核对公开的验证文件、抓取规则及完整站点地图，然后每批最多提交 10,000 个网址；只接受本域名的书籍、章节、作者、首页、排行榜和论坛入口，不提交账户、草稿、API、带参数的网址或外部地址。

HTTP 200 表示提交被接收，202 表示仍待验证 IndexNow 文件，均不保证收录。失败不自动重复整批提交。此命令不定时重复全量推送，也没有启用旧代码中的全局 EXTERNAL_SERVICES 开关。

协议：https://www.indexnow.org/documentation
站点地图：https://www.bing.com/webmasters/help/sitemaps-3b5cf6ed
