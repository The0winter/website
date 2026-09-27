# Cloudflare 网站防护

2026-09-27 19:21 UTC 因整站加载缓慢和超时，已将主域名及 www 恢复为 **DNS only**，Nginx 源站入口恢复 **observe**。主站当前不经过 Cloudflare 代理。Atlas 节流版本 `fd207d8`、数据库、备份、R2 图片和邮件配置保留。

## 当前状态与回退原因

- 主域名 A 记录仍为 `51.79.242.0`，www CNAME 仍指向主域名；只撤回本次启用的橙云代理。HTTPS 证书、HTTP/2 直连、站内认证及 Nginx 原有限速保留。
- Cloudflare 规则仍保存，但 **DNS only 的主站请求不会经过 Cloudflare WAF/限速/CDN**，不能将这些规则描述为当前生效。源站不能保留仅允许 Cloudflare 的入口限制，否则直连用户会收到 403。
- 真实浏览器在普通网络预取模式下复现：首页文档约 4–15 秒，点书约 3–12 秒；同一线上代码经源站对照约 1.6–2.4 秒。单请求健康检查和页面能打开不足以证明性能正常。
- 请求关联显示，一次目录 API 在应用中耗时 406 ms，Nginx 对外请求历时 6.252 秒；其他约 600 ms 的 API 也出现 4–10 秒的回传等待。服务器没有内存/CPU 耗尽或应用重启证据。
- 临时将 Cloudflare 回源改为 HTTP/1.1 后，源站长等待明显减少，但外部浏览器仍复现 9.9 秒首页和超过 10 秒的加载超时，因此没有把这项缓解当成最终修复。最终撤回新代理，并恢复源站原有 HTTP/2。证据支持代理链路引入回归，尚不能精确断言是 Cloudflare 内部实现还是具体网络路径。
- 回退顺序：先切换源站到 `observe` 并验证外网直连 200，再将主域名及 www 改为 DNS only。公网解析及 HTTPS 已确认直达原服务器。DNS 缓存及已有连接可能需要一段时间退出。
- 诊断日志新增 `protocol`、`upstreamSeconds`，用于区分应用处理与向外传输的耗时，不新增查询参数、正文或凭据记录。

本次不切换应用 release、不重建前端、不重启 API。回退快照位于 `/var/lib/test1-edge-backups/20260927T192027613232Z` 和 `/var/lib/test1-edge-backups/20260927T192032-restore-direct`。详细证据在 `.runtime/task-artifacts/detail-slow-20260927/`。

验收入口仍为 `cloudflare-edge-live.spec.ts`，现在默认检查直连；必须显式设置 `TEST1_EDGE_LIVE=1` 才访问线上。覆盖手机/桌面首页点书、重复访问、正文、翻章、完整目录、排行和登录，保留普通链接预取，首页及详情导航各设 8 秒上限，首次导航前隔离 Google Analytics。若将来重新试用代理，需要额外设置 `TEST1_EDGE_EXPECT_PROXY=1`，并在不同网络下确认重复导航无回归；不能只凭一次快速的健康检查再次开启全站代理。

## 首次接入配置（以下为回退前记录）

- `jiutianxiaoshuo.com` 的 A 记录、`www` 的 CNAME 从 DNS only 切换为 Proxied；IP、CNAME 目标、邮件和图片记录不变。公开 DNS 已返回 Cloudflare 地址。
- SSL/TLS 保持 Full (strict)。既有 DDoS 防护、浏览器完整性检查和 `Allow_search_engine` 规则保留。
- 新增免费限速规则 `Chapter burst protection`，ID `ee7780488fb14349b69a425ddc1007ce`：`(http.request.uri.path wildcard "/book/*/*" and not cf.client.bot)`，同一 IP 每 10 秒超过 60 次时 Block 10 秒。实测返回 429，窗口结束后恢复；只匹配章节页面，不把静态资源、API、登录和上传计入此规则。
- `cf.client.bot` 使用 Cloudflare 验证结果，不依据可伪造的 User-Agent 放行。既有搜索引擎 Skip 规则未扩大。
- Bot Fight Mode、Under Attack Mode 保持关闭。免费 BFM 不能按接口设置 Skip，当前优先采用可限定范围的规则，避免干扰监测、导入及正常阅读。没有新增付费套餐。
- 静态 JS/CSS 已验证 MISS 后 HIT；HTML/JSON 保留现有动态行为，不启用全站 Cache Everything，避免个人数据串用和内容更新延迟。

## 源站配置和日志

通用安装器：`infra/cloudflare-edge.py`。它从 Cloudflare 官方 IP API 获取并校验 IPv4/IPv6 网段，默认预览；`--apply` 才保存配置，并在 `nginx -t`、logrotate 配置校验通过后 reload。失败自动恢复本次配置。它不会切换应用版本或修改防火墙、证书及账号。

- `/etc/nginx/test1-edge-http.conf`：仅信任 Cloudflare 网段提供的 `CF-Connecting-IP`；保留连接对端 IP 用于入口判断，避免所有访客共享一个 Cloudflare IP 限额。
- `/etc/nginx/test1-edge-https.conf`：主域名与 www 的 HTTPS 仅允许 Cloudflare 网络及本机 loopback，其他直连返回 403。这里是网络来源校验，不是账户级的客户端证书认证。
- `/etc/nginx/sites-available/test1`：追加上述 include 和独立诊断日志，其余线上上传限制、超时、静态压缩、转发及 TLS 设置保留。未来部署须保留这些 include。
- `/var/log/nginx/test1-public-traffic.jsonl`：只记录公开内容路径、来源 IP、连接对端、UA、可信 CF-Ray、状态、响应字节和时长；不记录查询参数、Cookie、Authorization、正文和账号信息。IP/UA 只用于诊断，不是自然人数或机器人身份的直接证明。
- 日志权限 0640；独立 `/etc/logrotate.d/test1-public-traffic` 每日轮转，保留 7 份、maxage 7 天，轮转检查时超过 20 MB 也会轮转。旧监测日志格式不变。
- HTTP 80 的 ACME challenge 通道保留，其他 HTTP 页面继续跳 HTTPS。本次补齐缺少的 `/var/www/letsencrypt/.well-known/acme-challenge/` 目录；临时探针已移除。证书续期配置使用 webroot。

先在 `observe` 模式启用真实 IP 和日志，验证橙云及公共服务并等待原 300 秒 TTL 后，才切换 `enforce`。配置快照位于：

- 初始配置：`/var/lib/test1-edge-backups/20260927T181116895447Z`
- 收紧源站前：`/var/lib/test1-edge-backups/20260927T182442973317Z`

在 VPS 上以 root 运行已提交版本的脚本：

```sh
python3 cloudflare-edge.py --mode enforce
python3 cloudflare-edge.py --mode enforce --apply
```

需应急恢复直连时，先用 `--mode observe --apply` 恢复原直连可用状态并验证，再在 Cloudflare 将主域名/www 调回 DNS only。不要先关橙云而仍保留源站入口限制。上述应急步骤会减少防护，只在故障回退需要时执行。单独回退限速可在 Cloudflare 停用这一个规则，不涉及其他规则。

## 首次接入的功能检查（未充分覆盖性能）

- Cloudflare 路径：首页、书籍、目录、正文、登录页、robots、sitemap、健康接口成功；www 保持 308 到主域名。两处网络观测均出现 CF-Ray。
- 手机 390px、桌面 1440px 阅读与翻章、登录页验收通过，首次导航前隔离 Google Analytics，未提交登录或创建业务内容。测试入口为 `TEST1_EDGE_LIVE=1 npm run test:browser -- cloudflare-edge-live.spec.ts`，默认不对线上发请求。
- 仅在服务器自己的 IP 上，对无效章节地址发送 90 次 HEAD：65 次 404、25 次 429，同时健康接口仍为 200。此验收流量使用 `Shiye-Edge-Rate-Test/1.0`，不作为真实流量证据。
- 外网直连主域名/www，即使伪造 `CF-Connecting-IP: 127.0.0.1` 也均为 403；正常域名四项监测通过。
- CSRF 返回 no-store、安全 Cookie；未授权上传仍返回应用 JSON 401/403，未被替换为挑战页。未进行真实上传或登录写入。
- 主域名/www 的 HTTP ACME 随机探针均返回 200 且内容一致；nginx、API、前端、备份 timer、certbot timer 正常。此为续期通道检查，并未重新签发证书。
- 初步日志中出现自家监测、Yandex、PetalBot、SERanking；后几类的部分来源完成反向 DNS 与正向地址一致性核对。样本仍很短，不能据此推断过去 6 GB 的精确组成。

高频规则针对突发扫描，低速或分散来源抓取仍需结合新日志判断。先积累可比的 24–48 小时，按章节请求量、主要来源、每千次访问数据库返回字节、429/5xx 和响应时间评估，再有针对性调整；不要以 UA 名称或单个共享 IP 直接长期封禁。数据库用量按用途的 BSON 估算已由现有 `mongo-usage` 记录，仍不是 Atlas 的精确计费字节。七天卡片需等待旧流量逐小时退出，不能以配置当天的滚动总数验收节流效果。

截图与详细验证结果位于 `.runtime/task-artifacts/cloudflare-guard-20260927/`，运行产物不提交 Git。

参考：[代理状态](https://developers.cloudflare.com/dns/proxy-status/)、[官方 IP 列表 API](https://developers.cloudflare.com/api/resources/ips/methods/list/)、[免费限速规则](https://developers.cloudflare.com/waf/rate-limiting-rules/)、[Bot Fight Mode 限制](https://developers.cloudflare.com/bots/get-started/bot-fight-mode/)。
