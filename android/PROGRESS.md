# Android 1.0 进度检查点

## 当前状态

Goal active；原生核心阅读/数据层已通过模块验收，App已跑通首批真实公网只读流程；社区、创作、完整端到端与跨端续读继续实现，尚未达到交付条件。

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

### 后端已上线及第二批同步合同

- `6e627de7a5162d43bb18405fb8ff746e73750b21` 已提交推送并兼容部署。current为 `/srv/test1/releases/auto-6e627de7a516-20261003155738`，activatedAt `2026-10-03T15:58:58.190192+00:00`，健康/页面/目录/正文及保留策略验证通过。
- 另一个任务在开发期间提交并部署 `ea2ef5744bc0`（论坛首页优化），本次基于其已上线release增量部署，保留其功能；App范围仍固定开工版本957b99b中的131项，不自动缩减。
- 服务器未安装auto-deploy.service且release中无auto-deploy.py；未变更系统常驻配置。通过SSH stdin运行本仓库既有 `infra/auto-deploy.py --apply` 完成受锁保护的构建/切换/验收，证据 `deploy-apply.json`。
- NativeSession/ReadingPosition/ReadingPositionOperation索引已按模型非破坏性创建，`deploy-indexes.json`；公网真实正文hash、访客偏好与401拒绝检查见 `backend-public-verified.json`。
- 书架单项修订、删除墓碑、幂等与老网页双向兼容已实现，250项后端测试通过/3跳过/0失败，新增书架MongoDB验收通过；新书架接口尚待本批部署。
- API36无头模拟器已完成安装和Activity启动，保持后台 `emulator-5554`。这仍只是工具链检查，业务端到端继续进行。
- release签名密钥已创建并验证，独立私密目录与公开证书见 `SIGNING.md`，未加入Git。最终release APK仍未生成/交付。

当前分工：`android_toolchain` 已转原生app/core:ui页面；`native_auth` 已转core:data；`parity_audit` 已转原生reader与字体/连续跨章滚动。主智能体负责API、部署、签名、后续网页精确续读和全量集成。

### 2026-10-03 16:30 UTC 模块集成检查点

- 用户将离线就餐，明确授权常规选择及原有任务范围内的许可自主处理；继续推进，不等待逐阶段确认。
- 书架CAS提交 `e75e6a8` 已推送；另一任务随后提交 `4e7857723d4b` 并自动部署，包含本次全部书架变更及assetlinks。current=`auto-4e7857723d4b-20261003161013`，activatedAt=`2026-10-03T16:11:43.792860+00:00`，部署验收及版本保留成功。
- 五个新增Mongo模型索引已创建；最新公网版本/真实正文hash/访客/拒绝未认证复核通过。签名release尚未生成，App Links系统关联未验收。
- core:data 16/16单元及Robolectric测试、lintDebug通过；真实API36 Keystore/Room跨重开与账号隔离3/3通过。模块证据 `gradle-2026-10-03T16-09-06-407Z.log`，实际完整Worker离线/进程恢复验收仍待集成。
- 独立reader 9个单测+5个API36模拟器用例通过：三模式、最多5章连续滚动、前后插入淘汰、中文楷/宋实际字体、跨章UTF16定位。证据 `verified-reader-summary.json` 及 `gradle-2026-10-03T16-21-13-486Z.log`；人工听觉TalkBack未冒充通过。
- App首次真实公网“精选→详情→正文→系统返回”、访客账号登录返回通过；搜索测试选择器已修待重跑。模块页已接真实网络，未据此批量勾选131项。
- 社区原生Feed/偏好/问答/文章/富文本/回复/本地Room草稿源码落盘，正在首次编译及端到端验证。创作/搬运/管理和网页精确锚点分别交两个Astra high继续实现。
- 本地真实隔离后端 `127.0.0.1:5081` 已运行，使用TestDatabase，合成书/章节/社区和3个实际认证账号。`android/tools/test-server.mjs`启动，凭据仅存忽略目录及androidTest构建资源，绝不进入源码或release APK。debug端点通过仅回环Gradle属性注入，release固定公网HTTPS。

### 2026-10-03 17:15 UTC 集成与兼容检查点

- 原生App公网只读3项通过；隔离账号的收藏、评分、回复真实写入已走通，段评等待排版的时序缺口已修，完整用例正在重跑。未据部分成功标整条通过。
- 网页精确进度已实现，8项状态机测试与5项真实Cookie/CSRF浏览器测试通过，覆盖三模式、字体/窗口重排、离线持久队列、账号切换和冲突选择；TypeScript及相关ESLint通过。实际APK与网页互相接续仍待集成验收。
- 复核发现跨标签切Cookie的检查/使用竞争，新增X-Reading-Account请求断言，并在同一次服务端鉴权后校验。真实HTTP合同证明旧账号队列不能读写新账号，拒绝时保留原队列。
- 原生社区已接原生富文本分块、连续答案、真实偏好/评论/回复/本地草稿和共享主题；新增离开编辑保护。正在API36模拟器执行真实流程，不把代码存在算作验收。
- 创作仓储10项及隔离后端只读9项通过，作品/章节/回收/搬运/管理已接入；新仪器用例涵盖发布编辑恢复、长章TXT、批量部分失败、草稿冲突、禁用撤销与管理员私密作品。管理员显式私密列表新增6项SQLite+6项MongoDB合同通过，尚待提交部署。
- 主机16GB内存不支持同时多个Gradle重负载；现限制单次构建、2workers、Kotlin同进程并协调设备锁。17:13启动core/data、app单元及Forum/Writer/App隔离仪器统一检查。
- release等价benchmark变体已隔离定义，非debuggable、同签名/R8，仅允许回环测试API。交付release固定公网HTTPS；性能/真实TalkBack、安装升级与签名APK最终验收仍未完成。

## 下一步

完成当前社区与创作业务实现、网页段落锚点双向续读；在隔离数据上逐角色执行真实写操作、失败恢复及离线测试，逐项更新功能表；再做release性能/安装升级/签名验收并交付。
