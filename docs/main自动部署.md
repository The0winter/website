# main 自动部署

目标为 `The0winter/website` 的 `main` 与现有 `jiutianxiaoshuo.com` VPS。仓库可匿名读取，不使用 GitHub token、SSH 部署密钥、GitHub Secrets、webhook 或新增入站端口。

## 启用边界

代码默认只生成计划。启用 `test1-auto-deploy.timer` 会新增一个长期以 root 运行的发布服务，每分钟检查一次公开仓库。它需要准备版本目录、调用现有预览服务、切换 `/srv/test1/current`、临时调整现有 nginx 上游、重启前端/API、回滚及调用既有版本清理服务的权限。安装启用前必须明确确认这项持久执行权限；提交本文件或推送代码本身不会启用服务。

服务脚本固定安装在 `/usr/local/lib/test1/auto-deploy.py`，不会从 main 自动更新自己或 systemd 配置。构建在现有 `test1-web` 非特权账户下运行，生产密钥仅在服务器已有环境内使用，不传回本机或 GitHub。

## 发布行为

1. 对固定仓库匿名 fetch main；使用 `/run/lock/test1-release-deployment.lock` 排斥并发发布。现有版本尚未验收或预览端口被占用时停止。
2. 要求 main 是当前 `sourceCommit` 的后续历史。只处理 `web-next`、`server`、`shared` 中的运行源码，核对每个改变文件在线版本与 Git 基线，保留全部线上未涉及功能。新增文件碰撞、符号链接、目录越界和基线差异都阻止切换。
3. 依赖清单、环境配置、数据库/迁移、Next 配置及密钥文件变化需要单独审核，自动流程停止；不会运行迁移、改动数据库或安装持久基础设施。测试、文档、采集工具与基础设施代码不作为运行源码自动覆盖。
4. 从当前兼容版本复制候选目录，复用只读依赖，以 `test1-web` 构建；构建或校验失败时不切换。每个新 main 提交都产生一个候选版本，包括没有运行源码变化的提交，便于追踪已处理的仓库进度。
5. 在回环 3001 预览校验首页、详情、目录与真实正文；通过现有预热切换逻辑更新 current 并重启前端/API。公网版本标记、内容与健康检查通过后才写 `activatedAt`；失败恢复前一版本和 nginx 配置。
6. 停止预览并调用现有保留工具，保留当前及两个兼容回滚版本。清理失败单独记录，不回滚已经通过验收的服务，不绕过保留保护。

`/deployment-version.json` 仅公开当前源码提交与准备时间，便于核对公网生效。`/var/lib/test1-auto-deploy/last-run.json` 保存进度；构建日志保存在同目录的 `last-build.log`，仅 root 可读。相同失败 SHA 不会每分钟重复构建；人工修复并审查后可用 `--retry` 重新执行，或推送新的修复提交。

## 审批后的安装与核验

使用已经审核的提交内容安装以下三个文件，不复制任何凭据：

- `infra/auto-deploy.py` → `/usr/local/lib/test1/auto-deploy.py`，root:root，0644。
- `infra/systemd/test1-auto-deploy.service` → `/etc/systemd/system/test1-auto-deploy.service`，root:root，0644。
- `infra/systemd/test1-auto-deploy.timer` → `/etc/systemd/system/test1-auto-deploy.timer`，root:root，0644。

先执行 `systemd-analyze verify` 检查单元，再运行不带 `--apply` 的脚本核对计划。确认后执行 `systemctl daemon-reload` 与 `systemctl enable --now test1-auto-deploy.timer`。真实触发验收应等待 timer 发现 main 新提交，核对 `last-run.json` 的 accepted、manifest 的完整 sourceCommit、前端/API 健康和公网版本标记，并做屏蔽 GA 的无头手机验收。不能把单元文件存在、计划成功或手动调用脚本当作自动触发成功。

暂停用 `systemctl disable --now test1-auto-deploy.timer`；正在运行的发布先查看阶段，不直接终止切换过程。回滚沿用既有版本目录与 manifest 记录，不回退业务数据。

本地保护测试通过根目录 test 环境运行：`node --require ./tools/test-env.cjs` 启动 Python 的 `infra/tests/test_auto_deploy.py`，保证临时 Git 仓库位于 `.runtime/test-tmp/`。
