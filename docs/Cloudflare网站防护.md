# Cloudflare 网站防护

2026-09-27 19:21 UTC 因整站加载缓慢和超时，已将主域名及 www 恢复为 **DNS only**，Nginx 源站入口恢复 **observe**。主站当前不经过 Cloudflare 代理。Atlas 节流版本 `fd207d8`、数据库、备份、R2 图片和邮件配置保留。

## 当前状态与回退原因

- 主域名 A 记录仍为 `51.79.242.0`，www CNAME 仍指向主域名；只撤回本次启用的橙云代理。HTTPS 证书、HTTP/2 直连、站内认证及 Nginx 原有限速保留。
- Cloudflare 规则仍保存，但 **DNS only 的主站请求不会经过 Cloudflare WAF/限速/CDN**，不能将这些规则描述为当前生效。源站不能保留仅允许 Cloudflare 的入口限制，否则直连用户会收到 403。
- 真实浏览器在普通网络预取模式下复现：首页文档约 4–15 秒，点书约 3–12 秒；同一线上代码经源站对照约 1.6–2.4 秒。单请求健康检查和页面能打开不足以证明性能正常。
- 请求关联显示，一次目录 API 在应用中耗时 406 ms，Nginx 对外请求历时 6.252 秒；其他约 600 ms 的 API 也出现 4–10 秒的回传等待。服务器没有内存/CPU 耗尽或应用重启证据。
- 当时尝试通过删除主站 `listen` 上的 `http2` 参数改用 HTTP/1.1，但后续核对发现，同一 443 端口的备用站点仍启用 HTTP/2，19:17–19:21 的 79 条已记录协议的 Cloudflare 请求全部仍为 `HTTP/2.0`。因此撤回“HTTP/1.1 已缓解问题”的判断；那次测试没有完成有效的协议切换。最终撤回新代理，并恢复主站原配置。证据支持代理路径出现回归，尚不能精确断言是 Cloudflare 内部实现还是具体网络路径。
- 回退顺序：先切换源站到 `observe` 并验证外网直连 200，再将主域名及 www 改为 DNS only。公网解析及 HTTPS 已确认直达原服务器。DNS 缓存及已有连接可能需要一段时间退出。
- 诊断日志新增 `protocol`、`upstreamSeconds`，用于区分应用处理与向外传输的耗时，不新增查询参数、正文或凭据记录。

本次不切换应用 release、不重建前端、不重启 API。回退快照位于 `/var/lib/test1-edge-backups/20260927T192027613232Z` 和 `/var/lib/test1-edge-backups/20260927T192032-restore-direct`。详细证据在 `.runtime/task-artifacts/detail-slow-20260927/`。

验收入口仍为 `cloudflare-edge-live.spec.ts`，现在默认检查直连；必须显式设置 `TEST1_EDGE_LIVE=1` 才访问线上。覆盖手机/桌面首页点书、重复访问、正文、翻章、完整目录、排行和登录，保留普通链接预取，首页及详情导航各设 8 秒上限，首次导航前隔离 Google Analytics。若将来重新试用代理，需要额外设置 `TEST1_EDGE_EXPECT_PROXY=1`，并在不同网络下确认重复导航无回归；不能只凭一次快速的健康检查再次开启全站代理。

## 进一步隔离诊断（2026-09-27 19:40–20:10 UTC）

主域名和 www 始终保持 DNS only，应用 release、Nginx 和数据库配置不变。仅让诊断浏览器通过 `--host-resolver-rules` 将主域名连接到先前观测到的 Cloudflare IPv4 地址，保留真实 Host/SNI、证书校验和站内导航。CDP 的连接地址及响应的 CF-Ray 确认这些测试实际经过 Cloudflare。这样可以在不恢复全站橙云的情况下继续取证。

### 已确认的证据

- 故障窗口 18:55–19:21 UTC 的源站公开路径日志中，755 条 Cloudflare 请求包含 720 个 200、14 个 304、19 个 499、2 个 404；其中 24 个成功请求耗时超过 4 秒，CF-Ray 均以 CPH 结尾。该样本包含主动测试，不代表全部用户，也不能单凭节点后缀认定 CPH 节点故障。
- 18:59:36 UTC 三个 API 请求在应用中的耗时分别为 604、610、651 ms，而 Nginx 请求历时分别为 10.747、10.747、10.746 秒。这将主要额外等待定位到应用处理之外；结合回退效果，优先调查源站向代理传输及代理后续回传。这里的 Nginx 总时长不是浏览器端完成时间。
- 隔离浏览期间，服务器到 Cloudflare 的一条 TCP 连接累计发送 12,663,723 字节，其中重传 418,035 字节；观测到发送队列达到 1,481,751 字节、拥塞窗口降至 10 段。它证明此次采样存在重传与排队，但并非原故障同时段的抓包，不能直接证明它造成了先前的每一次超时，也不能把重传字节比例当成精确丢包率。
- 站点 `/icon.png` 为 812,462 字节，测试中的多次导航会重复请求。一次直连 HTTP/2 并发传输中，图标和小型书籍接口均约 5.5 秒才完成，说明大响应可能放大共享连接的等待；该现象也能出现在直连，因此图标过大不能单独解释 Cloudflare 回归。Playwright 路由拦截会禁用浏览器 HTTP 缓存，真实用户的重复下载频率不能由这些测试推算。

### 有效的协议对照

本次实际通过 Cloudflare 的 **HTTP/2 to Origin** 开关切换回源协议；关闭后服务器日志确认 `HTTP/1.1`，恢复后确认 `HTTP/2.0`。浏览器到 Cloudflare 的 HTTP/2、HTTP/3 与 Cloudflare 到源站的协议是两段独立连接，不能混为一项设置。

| 对照 | 测量结果 | 能支持的判断 |
| --- | --- | --- |
| 两个 Cloudflare IPv4 入口，浏览器强制 HTTP/2 或允许 HTTP/3 | 均能完成首页、点书和并发下载；未复现原有 10 秒以上停顿 | 暂无证据认定某一个入口或浏览器协议必然失败 |
| HTTP/1.1 回源，手机和桌面并发，各连续点书 4 次 | 首页 0.64–1.07 秒，点书 1.93–2.78 秒 | 此条件下工作正常 |
| 恢复 HTTP/2 回源，重复同一组测试 | 首页 0.36–2.45 秒，点书 1.49–2.50 秒 | 不能把关闭 HTTP/2 认定为已验证修复 |
| 重放先前首页往返、不同书籍及截图流程 | 手机和桌面均完成，未复现原超时 | 原故障暂未稳定复现 |

所有浏览器测试首次导航前隔离 Google Analytics，并拦截阅读计数和自有流量上报。测试以 Chrome、新建会话和当前网络为主；指定 IP 会绕开常规 DNS/HTTPS 记录发现，不能覆盖故障时的 DNS 缓存、旧连接状态、IPv6 和所有用户网络。测试通过不代表可以立即恢复全站代理。

### 结论与保留状态

当前最有证据的调查方向是 **代理路径上的传输排队/重传，以及并发连接行为**。尚不能区分具体网络路由、Cloudflare 的连接状态或源站协议交互，也没有证据证明某项常规开关漏配。官方确有 HTTP/2 多路复用及 Chrome HTTP/3 停顿的排查说明，但本次协议对照没有建立相应因果关系，不能套用为本网站的根因。

临时开关已恢复：HTTP/2 to Origin 开启、HTTP/3 开启；主站和 www 仍为 DNS only，源站仍为 observe。没有重新启用全站代理、升级套餐、清缓存或修改真实用户的浏览器设置。后续若继续复现，应在同一时间保存浏览器网络日志、按 CF-Ray 关联的源站请求和 TCP 指标，再比较不同网络；凭节点名称、一次健康检查或单次快慢不足以下结论。

本次证据位于 `.runtime/task-artifacts/cloudflare-root-cause-20260927/`：`incident-evidence.py.log`、`connections.py.log`、`past-protocol.py.log`、`edge-*.json`、两组 `edge-batch-origin-*.json` 和 `verified-protocol-restored.png`。重放结果位于先前任务目录的 `edge-exact-replay-timing-*.json`。原始运行产物不提交 Git。

参考：[Cloudflare 协议故障排查](https://developers.cloudflare.com/speed/optimization/protocol/troubleshooting/protocol-troubleshooting/)、[HTTP/2 回源](https://developers.cloudflare.com/speed/optimization/protocol/http2-to-origin/)、[Nginx HTTP/2 模块](https://nginx.org/en/docs/http/ngx_http_v2_module.html)。

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
