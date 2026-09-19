# 百度 SEO

当前主地址为 `https://jiutianxiaoshuo.com/`。带 www 的地址会跳转到主地址，页面 canonical 和提交的网址应保持一致。百度必须分别验证正在提交资源的站点，不删除原站点即可添加新的主地址。

## 验证与站点地图

主地址使用 `web-next/public/baidu_verify_codeva-0Z2GGo0lew.html`；原 www 站点的验证文件继续保留。文件验证通过后不要删除对应文件。

百度的 sitemap 提交通道要求文件直接列出网页链接。百度专用地图复用现有公开书籍、章节和作者来源，按每文件最多 50,000 个网址、最多 9,500,000 UTF-8 字节（含 XML 声明，预留 10 MB 上限余量）自动拆分。第一份保留 `https://jiutianxiaoshuo.com/sitemap-baidu.xml`，后续为 `/sitemaps/baidu/2.xml`、`/sitemaps/baidu/3.xml` 等；每份都是直接列出网页链接的 `urlset`。

完整文件清单见 `https://jiutianxiaoshuo.com/sitemap-baidu.json`。有配额时逐份提交清单中的 XML 地址；不要提交此 JSON 清单、Google/Bing 的 `/sitemap.xml` 索引，也不要把第一份误当成全站地图。百度后台配额为 0 时保留提交待办，不绕过限制。

为避免冷启动时全库聚合超出代理的 15 秒等待上限，每份只聚合最多 10 个书籍分区和 10,000 个静态/作者链接，实际单文件最多 20,010 条，低于百度上限；再校验编码后的文件大小。每份最多并行读取 6 个公开分区，共享计划及已完成文件 5 分钟；新增发布页面随来源及缓存刷新进入地图。所需源数据失败返回可重试的 503，不输出不完整的成功文件。巡检会展开全部百度文件，与一般地图逐条比对唯一性、完整性、公开地址和容量，并记录每份数量和字节数。此机制不等于发布后即时推送。

核验命令：

```sh
node infra/check-seo.mjs https://jiutianxiaoshuo.com https://jiutianxiaoshuo.com --sitemaps --baidu
```

## 普通收录 API

`server/baidu_push.js` 会展开 sitemap 索引，只提取本域名的公开网页，默认只预览。实际提交须提供对应已验证主地址的 `BAIDU_PUSH_TOKEN`，不能沿用错误站点的 token，也不应把 token 写入仓库。

```sh
node server/baidu_push.js --limit 10
node server/baidu_push.js --apply --limit 10
```

数量应以平台当天剩余配额为准，单次最多 1,000 条；小额提交优先覆盖入口。历史默认写入忽略的 `.runtime/baidu-seo/pushed_history.json`；服务器可用 `BAIDU_HISTORY_FILE` 指定跨版本目录。仅确认接收的网址写入历史，失败或无法解释的部分成功不推进记录。旧脚本强加 www、提交分区文件、硬编码 token 和误记整批成功的行为已移除。

工具使用百度平台下发的 `http://data.zz.baidu.com/urls` 接口，不绕过 HTTPS 证书检查。优先通过登录后的网页提交可用配额；API token 只在需要 API 时通过受控的本机或服务器环境提供。`auto_update.bat` 的现有总开关仍然生效。

抓取诊断和链接提交成功都不保证实际收录或排名。百度后台的历史错误应结合最新诊断时间判断。

官方说明：
- https://ziyuan.baidu.com/college/articleinfo?id=3217
- https://ziyuan.baidu.com/linksubmit/index
