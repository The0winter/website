# Android 1.0 进度检查点

## 当前状态

Goal active；处于功能基线和首个真实阅读链路实现阶段，尚未达到交付条件。

## 2026-10-03 开工检查

- 完整读取根 AGENTS.md、web-next/AGENTS.md、技术方案及 Goal 开工提示词。
- 已 fetch，main 与 origin/main 同为 `317d4a6e8bd90803896e26e2b1f16c5bdc87cab5`。
- 公网 deployment-version.json 为 `957b99b0fc3f9be598ed37d9b8c279379caaec7f`，本地其后只有文档提交。部署实际文件复核进行中。
- 未提交改动已保存初始清单；现有论坛、采集和正文导入改动均归其他任务，本 Goal 不覆盖/夹带。
- 全量功能审计、构建工具链与原生认证并行实施。没有已验收完成的 App 业务项。
- 本机 PATH 尚无 Java/Gradle/adb，Android SDK 默认位置不存在。工具链子任务正使用官方源准备固定目录。

## 恢复入口

### 用户更新的验收条件

2026-10-03 用户回复“我没有多余的安卓手机，这一条验收要求就略过吧”。取消真机验收要求，不再将真机缺失作为交付阻碍。仍须在无头模拟器完成安装、业务端到端、性能与恢复验收，报告不得称真机通过。

先读 `PLAN.md`、本文件及 `FEATURE_PARITY.md`（生成后）；检查 live agents 和 Git 工作区。不要重新创建 Goal，不从头重复调查。

## 证据位置

- `.runtime/task-artifacts/android-v1/initial-git-status.txt`
- `.runtime/task-artifacts/android-v1/initial-public-version.json`

## 已完成的内部检查点（不代表 App 业务验收通过）

- 全量盘点131项，线上仍有而本地未提交删除的推荐设置等功能保留在1.0清单。
- 线上实际源码425项一致、36项差异、0缺失；来源比对见 `initial-source-comparison.json`。
- 原生账号会话、刷新轮换、设备撤销、浏览器CSRF隔离已实现，MongoDB与SQLite合同测试通过。
- 签名访客身份、推荐身份保持、匿名阅读回执及精确路径CSRF例外已实现；不能用访客凭据访问账号/管理功能。
- 章内位置、UTF-16校验、CAS修订、幂等回执、最近/最远分离、删除墓碑及旧网页章级历史兼容已实现。网页精确锚点和Android消费仍未集成完成。
- 后端完整回归252项：249通过、3个原有条件跳过、0失败。MongoDB新增进度/访客测试2项通过；native-auth MongoDB13项通过。fixture退出偶有ECONNRESET日志，测试进程exit0，未将此描述为线上验收。
- JDK17/SDK36/Gradle8.13/AGP8.13.2/Kotlin2.2.20已安装并成功assembleDebug。这里只证明工程构建；空入口APK不计业务完成。
- reader模块、core:data仓储/认证/离线同步正在独立实现；无头API36模拟器正在启动，WHPX加速可用。

证据：`server-regression.log`、`native-integration.log`、`native-auth-verified.log`、`native-auth-mongodb.log`、`progress-mongodb.log` 均位于 `.runtime/task-artifacts/android-v1/`。

## 下一步

完成部署实际源文件比对；确定同规范锚点与修订冲突合同；构建真实 API 数据仓库、阅读器及原生导航；其后按功能表持续实现全部业务。
