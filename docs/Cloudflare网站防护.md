# Cloudflare 网站防护

2026-09-27 完成主站代理、防刷及源站入口配置。此次只更新 Cloudflare 和 Nginx；保留主线程已上线的 Atlas 节流版本 `fd207d8`，未切换应用 release、重启 API/前端或修改业务数据。

## 当前配置

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

## 验收和后续观察

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
