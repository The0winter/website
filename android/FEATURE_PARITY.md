# Android 1.0 全功能对照与验收清单

盘点日期：2026-10-03（Europe/Berlin）。源码基线：`main`，`HEAD = origin/main = 317d4a6e8bd90803896e26e2b1f16c5bdc87cab5`。本轮先检查开工工作区实际文件，再按主任务提供的线上比对复核差异；开工已有 17 个 tracked 未提交文件及历史未跟踪文件，保留记录见 `.runtime/task-artifacts/android-v1/initial-git-status.txt`，不能将工作区事实无条件视作该提交事实。

**线上基线已核对**：`/srv/test1/releases/auto-957b99b0fc3f-20261003145451`，`sourceCommit=957b99b0fc3f9be598ed37d9b8c279379caaec7f`，`activatedAt=2026-10-03T14:56:35.126077+00:00`。主任务源码哈希比对425个相同、36个不同、0缺失，证据 `.runtime/task-artifacts/android-v1/initial-source-comparison.json`。本地HEAD比线上提交仅多3个文档变更；工作区未提交的论坛改动删除了线上仍有的“推荐偏好/换一批”。本清单已用 `git show 957b99b0fc3f9be598ed37d9b8c279379caaec7f:web-next/app/forum/page.tsx` 和相关缓存代码复核，**F23–F28按线上版本保留**，不把未提交删除当范围缩减。本文件是源码与release对照后的实施清单，尚不是 Android 验收通过报告。

范围是首版全部现行网页业务及 Goal 明确追加的离线、原生认证、精确跨端续读能力。阶段划分不缩减 1.0。原生页面不得以 WebView 代替。所有下表“待实现/待验收”均表示盘点时尚无已验证 Android 实现；后续只能在关联真实实现和验收产物后改为通过。

**验收条件更新（2026-10-03）**：用户明确“我没有多余的安卓手机，这一条验收要求就略过吧”，取消真机验收。表中真机要求均以此更新为准，其余性能、安装、无障碍、恢复与业务检查仍在无头模拟器执行并注明环境，不能描述为真机通过。

## 阅读方式与权限

- `访`：访客；`读`：登录 reader；`作`：作品所有者（不是独立角色，普通 reader 即可创作）；`管`：admin。封禁、会话撤销、测试展示账号禁登录等由服务器裁决，不能信任客户端隐藏按钮或 `x-user-id`。
- `双`：移动/桌面均有业务；`移`/`桌`说明现行入口差异。Android 必须保留桌面独有的有效业务能力，布局按手机/平板重新设计。
- 表内接口均以 `/api` 为前缀（特别标明者除外）。`本地`表示网页当前仅在浏览器保存；不是服务端已有接口。
- `W:` 后为 `web-next/` 下文件，`S:` 后为 `server/` 下文件，`T:` 后为 `web-next/tests/` 下现有测试线索；服务器测试显式写 `server/tests/`。这些是源码证据/验收用例种子，**本次盘点没有运行这些历史测试，存在旧用例与新代码不一致的情况**，不能据名称写“已通过”。各行末尾写明 Android 必须补的验证。
- 验收覆盖真实 API、隔离测试账号及作品、访客/reader/作者/admin、失败重试、身份切换、返回及进程恢复。线上浏览器验收首次导航前屏蔽 GA。不得污染真实业务数据。

## 发现、书籍与公共主页

| ID | 网页入口/平台 | 实际行为与权限 | App 预期入口 | API/状态来源 | Android 状态 | 源码及验收证据要求 |
|---|---|---|---|---|---|---|
| D01 | `/`；双 | 访/读；品牌首页、精选列表与书籍卡片 | 书城→精选 | GET `/books?orderBy=discovery&limit=59`，首页数据组装 | 待实现/待验收 | W:app/page.tsx、components/HomePageClient.tsx、MobileHome.tsx；T:discovery.spec.ts；真实推荐、空态、返回保位 |
| D02 | 首页每日推荐/轮播；双，展现不同 | 每日固定精选与封面轮播、点书进入详情 | 书城→每日精选 | GET `/books?orderBy=featured_daily&limit=3` | 待实现/待验收 | W:components/MobileFeaturedBanner.tsx；S:services/daily-featured.js；T:daily-banner.spec.ts、featured-shelves.spec.ts；每日一致性、手势和点击 |
| D03 | `/?view=category&category=…`；移；桌首页分类区 | 分类选择、全部、热度排序、分页 | 书城→分类 | GET `/books?category=&orderBy=views&page=&limit=`；X-Total-Count | 待实现/待验收 | W:components/MobileCategoryPicker.tsx、MobileHome.tsx、HomePageClient.tsx；T:category-popover.spec.ts、home-category-pin.spec.ts；分类切换页码重置、总数 |
| D04 | `/?view=new`；移，新书入口 | 按创建时间浏览新书、分页 | 书城→新书 | GET `/books?orderBy=createdAt&order=desc&page=&limit=` | 待实现/待验收 | W:components/MobileHome.tsx；T:mobile-browsing-polish.spec.ts；新书顺序、下一页 |
| D05 | 桌首页热门/榜单/分类模块；移精选分组“更多” | 浏览热门、推荐、跳排行/分类；不是独立新数据库 | 书城分组与“更多” | GET `/books` 相应 orderBy | 待实现/待验收 | W:components/HomePageClient.tsx、lib/discovery-sections.ts；T:home-shortcut-navigation.spec.ts；全部有效模块可达 |
| D06 | 首页/导航搜索框；双 | 按书名/作者实时建议（最多 6）、清空、键盘选择/提交 | 顶部搜索 | GET `/books?q=&limit=6&page=1` | 待实现/待验收 | W:components/BookSearch.tsx；T:search-suggestions.spec.ts；取消旧查询、无匹配、快速输入 |
| D07 | `/search?q=&page=`；双 | 书名或作者关键词检索，20 条/页，空态/重试、详情返回保留词与页 | 搜索→结果 | GET `/books?q=&limit=20&page=`；X-Total-Count | 待实现/待验收 | W:app/search/page.tsx；T:book-detail-search-return.spec.ts；真实搜索/分页/返回 |
| D08 | `/ranking`；双 | 日/周/月/总/浏览五榜，类别筛选、分页、返回位置 | 书城→排行榜 | GET `/books?orderBy=rank_day/ rank_week/ rank_month/ rank_total/ views&fields=ranking&category=&page=&limit=`（值无空格） | 待实现/待验收 | W:components/RankingFrame.tsx、RankingList.tsx；S:services/ranking.js；T:ranking.spec.ts、ranking-pagination.spec.ts、ranking-return.spec.ts；不能以 views 代替四个综合榜 |
| D09 | `/author/:id`；双 | 作者身份、其公开作品按更新排序、20 条/页；导入作者身份与账号作者不同 | 详情→作者主页 | GET `/authors/:id`；GET `/books?author_id=&orderBy=updatedAt&order=desc&page=&limit=20` | 待实现/待验收 | W:app/author/[id]/AuthorPageClient.tsx；S:services/author-identity.js；T:author-identity.spec.ts、author-navigation.spec.ts；旧别名 canonicalId、无书/无此人 |
| D10 | `/book/:id`；双 | 书名、作者、封面、分类/连载状态、简介展开/收起、字数/更新/阅读/评分信息 | 书籍详情 | GET `/books/:id/detail`；兼容 GET `/books/:id`、`/statistics` | 待实现/待验收 | W:components/BookDetailClient.tsx；S:routes/book-detail.js；T:book-description.spec.ts、book-counts.spec.ts；详情部分接口失败仍可看简介 |
| D11 | 详情“开始/继续阅读”；双 | 从有效最近章继续，否则首章；无章节不可进入；直接深链也可读 | 详情→阅读 | 本地 reading-session；云历史；GET `/chapters/:id?reader=1&navigation=1` | 待实现/待验收 | W:components/ReadingEntryLink.tsx、lib/reading-session.ts；T:reader-entry.spec.ts、reader-handoff.spec.ts；错书章ID/删除章/无章 |
| D12 | 详情/阅读器收藏；双 | 读；加入/移出本人书架、已有状态；访客提示登录 | 详情/阅读工具→书架 | GET `/users/:uid/bookmarks/:bid/check`；POST `/users/:uid/bookmarks` {bookId}；DELETE `/users/:uid/bookmarks/:bid` | 待实现/待验收 | S:routes/content.js；T:library.spec.ts；重复添加、失败回滚、账号切换 |
| D13 | 详情“作品里程碑”；双 | 收藏/浏览累计、历史成就、下一阈值、说明，未知日期“历史达成” | 详情→里程碑 | GET `/books/:id/milestones` {counts,events,next} | 待实现/待验收 | W:components/BookMilestones.tsx；T:book-milestones.spec.ts；删除收藏不抹掉旧成就、北京时间 |
| D14 | 详情相关推荐；双 | 同类优先、热门补足、排除当前书、点击跳详情 | 详情→你可能喜欢 | GET `/books?orderBy=views&limit=9&category=` + 热门 fallback | 待实现/待验收 | W:components/BookRecommendations.tsx；T:book-recommendations.spec.ts；去重、少书/失败 |
| D15 | 详情分享；主要移 | 分享书名与正规书籍URL、复制；阅读后有限分享提醒 | 详情→Android Sharesheet/复制链接 | 本地；`https://jiutianxiaoshuo.com/book/:id` | 待实现/待验收 | W:components/BookShare.tsx、lib/share-reading.ts；T:book-share.spec.ts、share-reminder.spec.ts；取消不报成功、链接可跨端打开 |
| D16 | `/user/:id`（书评头像等）；双 | 公开昵称、头像/颜色、装扮、角色、加入日期；不公开邮箱 | 书友公开主页 | GET `/users/:id/profile` | 待实现/待验收 | W:app/user/[id]/PublicUserProfile.tsx；T:public-profile.spec.ts；无效/封禁身份、隐私 |
| D17 | 本人及公开主页最近阅读；双 | 最多8本真正阅读过的公开可用书（仅访问详情不计）；点详情 | 主页→最近阅读 | GET `/users/:id/recent-books` | 待实现/待验收 | W:components/ProfileRecentBooks.tsx；server/tests/public-recent-books.test.js；私密/删除过滤、顺序 |

## 目录、阅读器与书架

| ID | 网页入口/平台 | 实际行为与权限 | App 预期入口 | API/状态来源 | Android 状态 | 源码及验收证据要求 |
|---|---|---|---|---|---|---|
| R01 | 详情目录预览/全部目录；双 | 正序章节与卷标题、卷展开折叠、当前章节定位、长目录窗口加载 | 详情/阅读器→目录 | GET `/books/:bid/catalog?offset=&limit=&anchor=&version=`；GET `/catalog/version`；旧 `/chapters` 分页 | 待实现/待验收 | W:components/BookCatalogSheet.tsx、lib/book-catalog.ts；T:catalog-volumes.spec.ts、catalog-store.spec.ts；万章目录/卷折叠/位置恢复 |
| R02 | 目录拖动/滚动/选择；双 | 虚拟目录、滚动条定位、选择章、取消回原阅读位置 | 原生目录 sheet/全屏 | 同 R01；版本变化 409 返回最新 version | 待实现/待验收 | W:components/CatalogScrollbar.tsx、lib/catalog-layout.ts；T:reader-catalog-handoff.spec.ts、reader-history.spec.ts；不混版本、不下载全目录才开书 |
| R03 | `/book/:bid/:cid`；双 | 完整正文、章标题、前后章导航、首末章/异常重试 | 原生阅读器 | GET `/chapters/:cid?reader=1&navigation=1` → {book,chapter} | 待实现/待验收 | W:components/ReaderClient.tsx；S:app.js 正文路由；T:reading.spec.ts、reader-payload（服务器）；长章完整、跨章无漏/重复 |
| R04 | 阅读设置“左右翻页”；双 | 横向手势/两侧点击翻页，中央菜单，章末续章 | 阅读器→横向分页 | 本地排版/手势；正文同 R03 | 已实现；reader模块9单测/5模拟器用例通过，App整体验收待完成 | W:components/ReaderPages.tsx、useReaderPageTurn.ts；T:reader-pages.spec.ts、reader-taps.spec.ts；标点/中英/emoji/首行缩进/快速手势 |
| R05 | 阅读设置“上下翻页”；双 | 纵向手势/上下区域翻页，中央菜单 | 阅读器→纵向分页 | 本地 | 已实现；reader模块9单测/5模拟器用例通过，App整体验收待完成 | W:components/ReaderClient.tsx、ReaderPages.tsx；T:reader-interactions.spec.ts；不能省略第三种模式 |
| R06 | 阅读设置“上下滚屏”；双 | 连续滚动、相邻章节衔接、当前章随位置变、段评按所在章节 | 阅读器→连续滚动 | 本地有界正文预取；R03 | 已实现；reader模块9单测/5模拟器用例通过，App整体验收待完成 | W:components/ReaderScroll.tsx；T:reader-scroll.spec.ts、reader-continuity.spec.ts；跨章往返/内存有界/末章 |
| R07 | 阅读主题；双 | 灰/奶油纸/绿/蓝日间底色、夜间模式，菜单与正文协调 | 阅读设置→主题 | 本地 reader_themeColor；全站主题 | 待实现/待验收 | W:components/ReaderClient.tsx、lib/reader-paper.ts；T:reader-paper.spec.ts、site-theme.spec.ts；纸纹可读、夜间无闪白 |
| R08 | 正文字体/字号；双 | 黑体/宋体/楷体；可交互字号12–48（历史存值容许到72） | 阅读设置→字体、字号 | 本地 reader_fontFamily/fontSizeNum | 已实现；reader模块9单测/5模拟器用例通过，App整体验收待完成 | W:components/ReaderClient.tsx；T:reader-pages.spec.ts；字体覆盖中文、放大保持同段同字符，不能持久化屏幕页码 |
| R09 | 行距、段距；双 | 移动行距1.2–1.8步长0.1；四档段距；桌面不同布局选项 | 阅读设置→排版 | 本地 reader_lineHeight/paraSpacing | 已实现；reader模块9单测/5模拟器用例通过，App整体验收待完成 | W:components/ReaderClient.tsx；T:reader-interactions.spec.ts；重排锚点稳定、大字号不裁切 |
| R10 | 页面宽度；桌设置 | 桌面宽度选择；App大屏需保留可调版心能力 | 平板阅读设置→版心/边距 | 本地 reader_pageWidth | 待实现/待验收 | W:components/ReaderClient.tsx；手机按可用宽度合理映射，平板/横屏验证 |
| R11 | 阅读全屏开关/自动全屏；双 | 全屏偏好、退全屏不意外退书、提示可关闭 | 阅读设置→沉浸模式 | 本地；Android window insets | 待实现/待验收 | W:components/useReaderFullscreen.ts；T:reader-fullscreen-back.spec.ts、reader-auto-fullscreen.spec.ts；系统返回、旋转、键盘 |
| R12 | 阅读菜单、前后章、详情/书架返回；双 | 换章不膨胀返回栈，目录/设置优先关闭，返回详情/来源保位 | 阅读器导航/系统返回 | 本地 navigation state | 待实现/待验收 | W:lib/book-navigation.ts；T:reader-history.spec.ts、reader-fullscreen-back.spec.ts；深链冷启动/进程死亡/返回无环 |
| R13 | 段落长按/右键/键盘；双 | 段落“评论”“标记/取消标记”，标记仅当前浏览器按账号隔离 | 阅读器长按→标记/段评 | 本地 reader-paragraph-marks:user:chapter | 待实现/待验收 | W:components/ReaderPages.tsx、ReaderScroll.tsx；T:reader-interactions.spec.ts；同步不假定已有，重排保标记 |
| R14 | 阅读进度/访问记录；双 | 访客本地最近章；读者访详情记访问、读章记 chapterId/lastReadAt | 阅读器→本地+云续读 | POST `/users/:uid/history` {bookId,chapterId?}；lib/reading-session.ts | 待实现/待验收 | S:routes/library.js、models/ReadingHistory.js；T:library-reading.spec.ts；现有仅章级，不冒充章内同步 |
| R15 | 阅读量上报；双 | 真实章节阅读去重计数，不能仅详情曝光加阅读量 | 阅读器实际阅读后后台事件 | POST `/books/:id/views` {chapterId} | 待实现/待验收 | S:routes/reading.js；T:reader-counts.spec.ts；重复/失败/离线重试不刷量，统计隔离 |
| R16 | `/library`→书架；双、读 | 封面、最新章、已读章、直接续读、更多→详情、不可用书保留可删行 | 书架→收藏 | GET `/users/:uid/library?tab=shelf&sort=&page=&limit=20` | 待实现/待验收 | W:app/library/page.tsx；T:library.spec.ts、library-cache.spec.ts；book:null 不崩溃、不误开他书 |
| R17 | 书架→浏览记录；双、读 | 与书架独立的历史记录、详情访问也可列入 | 书架→历史 | GET `/users/:uid/library?tab=history&sort=&page=&limit=20` | 待实现/待验收 | T:library-management.spec.ts；访问与阅读语义区别、总数分页 |
| R18 | 书架/历史排序；双 | 综合/最近阅读/最近更新，保持全局排序再分页 | 书架工具栏→排序 | sort=combined/read/updated | 待实现/待验收 | W:components/LibraryToolbar.tsx；S:routes/library.js；T:library-entry-order.spec.ts；未发布元数据改动不伪装章节更新 |
| R19 | 单项更多→删除；双、读 | 书架删除只移收藏，历史删除只移历史；确认后执行 | 书架行菜单 | DELETE `/users/:uid/bookmarks/:bid` 或 `/history/:bid` | 待实现/待验收 | W:app/library/page.tsx；T:library-management.spec.ts；两类删除互不牵连 |
| R20 | “管理”批量选择/删除；双、读 | 当前页逐项多选、确认、部分失败保留/报告；翻页与状态恢复 | 书架→管理 | 逐条同 R19 | 待实现/待验收 | W:app/library/page.tsx；T:library-management.spec.ts；部分失败不假报整批完成 |
| R21 | 书架/历史页签滑动和分页；移手势、桌按钮 | 切页签保留各自状态、账号切换清旧缓存、错误保留旧数据可重试 | 原生 tabs/分页列表 | 同 R16–18；账号作用域本地缓存 | 待实现/待验收 | T:shelf-page-turn.spec.ts、shelf-navigation.spec.ts；快速切页不显示错账号/错页 |

## 账号与外观

| ID | 网页入口/平台 | 实际行为与权限 | App 预期入口 | API/状态来源 | Android 状态 | 源码及验收证据要求 |
|---|---|---|---|---|---|---|
| A01 | `/login`；双 | 邮箱或用户名+密码；错误锁定/封禁/测试展示账号拒绝 | 我的→登录 | POST `/auth/signin` {email或username,password}；现为Cookie | 待实现/待验收 | W:components/LoginPage.tsx；S:routes/auth.js；T:login.spec.ts；真实登录/失败/锁定，原生令牌另见 X01 |
| A02 | `/register`→验证码；双 | 邮件验证码发送、60秒间隔、每小时上限、过期/尝试限制 | 我的→注册→验证码 | POST `/auth/send-code` {email} | 待实现/待验收 | W:components/RegisterPage.tsx；S:routes/auth.js；T:register.spec.ts；发送失败可恢复，不能跳过验证码 |
| A03 | 注册提交；双 | 用户名规范化唯一、密码8字符且≤72 UTF-8字节，验证码；固定reader，不自授admin | 我的→注册 | POST `/auth/signup` {email,username,password,code} | 待实现/待验收 | server/tests/identity.test.js、security.test.js；T:registration-admin.spec.ts；中文/emoji用户名与密码、并发重复 |
| A04 | 全站会话/登录后回到操作；双 | session验证、真实活动续期、过期失效、失败不误判登出 | 全局认证与返回目的地 | GET `/auth/session`；POST `/auth/activity` | 待实现/待验收 | W:contexts/AuthContext.tsx、lib/session-activity.ts；T:session-activity.spec.ts、mobile-auth-entry.spec.ts；后台空闲不无端续命、缓存隔离 |
| A05 | `/profile`账号信息；双、读 | 本人昵称/邮箱/角色/注册信息、书架/创作入口 | 我的→账户 | session/profile | 待实现/待验收 | W:app/profile/page.tsx；T:profile.spec.ts、account-navigation.spec.ts；本人信息不泄漏公开主页 |
| A06 | 本人头像上传；双、读 | 选静态JPG/PNG/WebP，预览/上传/绑定；服务端归属校验 | 我的→编辑头像 | POST `/upload/cover` multipart file；PATCH `/users/:uid` {avatar} | 待实现/待验收 | S:routes/media.js；T:profile.spec.ts；图片大小/格式/像素、失败留原头像 |
| A07 | 主页装扮/头像颜色；双、读 | 四种 profileTheme、共享头像颜色集；取消不保存、保存跨端生效 | 我的→装扮 | PATCH `/users/:uid` {profileTheme,avatarColor} | 待实现/待验收 | W:lib/profile-themes.ts、components/AvatarColorPicker.tsx；shared/avatar-colors.mjs；T:profile-themes.spec.ts、avatar-colors.spec.ts |
| A08 | 修改密码；双、读 | 旧/新/确认密码；改密撤销所有会话并重新登录 | 我的→安全→改密 | POST `/auth/change-password` {oldPassword,newPassword} | 待实现/待验收 | S:routes/auth.js；T:account.spec.ts；网页Cookie与App会话同时撤销 |
| A09 | 退出登录；双、读 | 撤销当前会话，清个人缓存，恢复访客状态 | 我的→退出 | POST `/auth/logout` | 待实现/待验收 | W:contexts/AuthContext.tsx；T:account.spec.ts、forum-recommendations.spec.ts；草稿/下载/推荐不串号 |
| A10 | 全站亮/暗切换；双 | 系统色彩默认、本次访问手动选择；阅读/论坛共享主题 | 我的/快捷菜单→外观 | 本地 lib/site-theme.ts | 待实现/待验收 | T:site-theme.spec.ts；Android主题持久化规则需记录，与阅读底色独立 |

## 书评与段评

| ID | 网页入口/平台 | 实际行为与权限 | App 预期入口 | API/状态来源 | Android 状态 | 源码及验收证据要求 |
|---|---|---|---|---|---|---|
| C01 | 详情评分摘要/评论预览；双、访可读 | 5星内部1–5，展示2–10分；评分人数≠文字短评数；测试评分不计真实总分 | 详情→评分 | GET `/books/:id/reviews`；X-Book-Rating、X-Rating-Summary、X-Review-Distribution | 待实现/待验收 | S:controllers/reviewController.js；T:rating-reviews.spec.ts；种子统计/测试数据区别 |
| C02 | 查看全部评论 sheet；双 | 游标加载、重复文字折叠/展开、作者主页、失败重试 | 详情→全部短评 | GET `/books/:id/reviews?limit=&cursor=`；X-Next-Cursor、X-Total-Count | 待实现/待验收 | W:components/BookReviewSheet.tsx、lib/useReviewFeed.ts；T:review-sheet.spec.ts、review-content.spec.ts；真实长列表无重复漏项 |
| C03 | 写书评/编辑自己的评分；双、读 | 一用户一书一条；纯评分可行；短评最多140 Unicode码点；显式空文字删除自有文字但留评分 | 详情→评分/短评编辑 | GET `/books/:id/reviews/mine`；POST `/books/:id/reviews` {rating,content?} | 待实现/待验收 | W:components/BookReviewComposer.tsx、BookDetailClient.tsx；S:routes/content.js；T:review-composer.spec.ts；区分省略content与空串 |
| C04 | 短评喜欢/不喜欢；双、读写访读 | 互斥反应与取消，批量加载本人状态/计数 | 短评操作栏 | GET `/books/:id/review-reactions?ids=` 最多21；PUT `/books/:id/reviews/:rid/reaction` {reaction:like/dislike/null} | 待实现/待验收 | S:routes/review-reactions.js；server/tests/review-reactions.test.js；重试幂等/快速连点 |
| C05 | 短评回复预览/全部回复；双 | 回复按旧到新游标、10条/批；书评列表自带预览 | 短评→回复线程 | GET `/books/:id/reviews/:rid/replies?cursor=` → {items,total,cursor} | 待实现/待验收 | W:components/BookReviewReplies.tsx；S:routes/review-replies.js；T:review-replies.spec.ts；线程切换、删除作者fallback |
| C06 | 回复短评；双、读 | 1–1000码点、requestId幂等，同号不同内容409；登录返回保留上下文 | 短评线程→回复 | POST `/books/:id/reviews/:rid/replies` {content,requestId} | 待实现/待验收 | W:components/BookReviewReplyComposer.tsx；server/tests/review-replies.test.js；网络不确定时同ID重试 |
| C07 | 正文段评数量；双、访可读 | 每段评论数，正文仍可在段评接口故障时阅读 | 阅读器段落尾标记 | GET `/chapters/:cid/paragraph-comments` → {counts} | 待实现/待验收 | W:lib/reader-chapters.ts；T:reader-comments-resilience.spec.ts；段评故障不阻正文 |
| C08 | 段落→评论 sheet；双、访可读 | 引用当前段落、20条/页、上下页、用户头像 | 阅读器→段评 | GET `/chapters/:cid/paragraph-comments/:key?page=` → {paragraph,items,total,page,pageSize} | 待实现/待验收 | W:components/ParagraphComments.tsx；server/tests/paragraph-comments.test.js；当前段落已改409，不能错挂 |
| C09 | 发表段评；双、读 | 非空≤1000 UTF-16 code units；requestId幂等；正文版本再检查 | 段评→发表 | POST 同 C08 {content,requestId} | 待实现/待验收 | S:routes/paragraph-comments.js；shared/reader-paragraphs.mjs；中文/emoji边界、并发正文变更 |
| C10 | 段评删除；双、本人/管 | 自己或管理员删除；他人无权 | 段评行→删除 | DELETE `/chapters/:cid/paragraph-comments/:key/:commentId` | 待实现/待验收 | W:components/ParagraphComments.tsx；server/tests/paragraph-comments.test.js；越权与计数回写 |

## 论坛文章、问答与推荐

| ID | 网页入口/平台 | 实际行为与权限 | App 预期入口 | API/状态来源 | Android 状态 | 源码及验收证据要求 |
|---|---|---|---|---|---|---|
| F01 | `/forum`→推荐/热榜/关注；双 | 三类 feed；问答按答案 entry 展示，文章独立；游标继续、刷新、返回保位 | 社区→三个tab | GET `/forum/posts?tab=recommend/hot/follow&view=answers&format=page&limit=&cursor=` → {items,nextCursor} | 待实现/待验收 | W:app/forum/page.tsx、components/ForumTabs.tsx；S:app.js、services/forum-feed.js；T:forum-recommendations.spec.ts、forum-continuous.spec.ts；postId与entryId不能混 |
| F02 | 论坛搜索栏；双 | 对已加载内容做客户端匹配，提示继续加载；不是服务端全库搜索 | 社区→本页内容搜索 | 已加载feed本地过滤 | 待实现/待验收 | W:app/forum/page.tsx matchesSearch；T:forum-browser.spec.ts；提示范围准确，别声称全站检索 |
| F03 | 卡片“更多”反馈；双、访/读 | 不喜欢、不再推荐作者、太多重复/相似、极端引战、质量差、少看本书、少看主题 | 社区卡片→减少推荐 | POST `/forum/preferences` {entry,reason}；GET `/forum/preferences` | 待实现/待验收 | W:components/ForumFeedbackSheet.tsx、lib/forum-feedback.ts；S:routes/forum-recommendations.js；T:forum-recommendations.spec.ts；导入原作者不能当上传账号一起屏蔽 |
| F04 | 卡片→关注作者/本书；双、访/读 | 实际写入偏好并更新关注feed，缺乏相关身份时限制对应项 | 社区卡片→关注 | 同 F03，reason=followAuthor/followBook | 待实现/待验收 | W:components/ForumFeedbackSheet.tsx；T:forum-recommendations.spec.ts；跨设备读者一致/游客独立 |
| F05 | 反馈后提示“撤销”；双 | 删除刚写偏好、恢复推荐/关注状态 | 社区反馈 snackbar→撤销 | DELETE `/forum/preferences/:preferenceKey` | 待实现/待验收 | W:app/forum/page.tsx；失败不假恢复；账号切换取消旧请求 |
| F06 | 推荐自动更新/已读识别；双 | 可见卡片曝光、实际阅读、阅读深度等事件参与推荐；本人偏好与访客cookie分离 | 社区数据层 | GET `/forum/recommendations/receipt?entry=`；POST `/forum/recommendations/events` {events} | 待实现/待验收 | W:lib/forum-activity.ts、lib/forum-feedback.ts；server/tests/forum-recommendations.test.js；签名回执/事件去重，后台卡片不能上报可见 |
| F07 | `/forum/question/:qid`；双、访可读 | 问题正文/作者、回答预览、默认/最新排序、分页、点指定答案、写回答 | 社区→问题详情 | GET `/forum/posts/:id`；GET `/forum/posts/:id/replies?view=preview&sort=default/latest&page=&limit=` | 待实现/待验收 | W:components/ForumQuestionPage.tsx；T:forum-question.spec.ts；回答缩略不是完整正文 |
| F08 | `/forum/:postId?answer=…`（问答）；双 | 指定回答读取、连续读多回答、当前答案状态、下一篇、全部回答目录 | 社区→回答阅读器 | GET `/forum/posts/:id/reading?answer=`；GET `/forum/posts/:id/replies`、`?target=` | 待实现/待验收 | W:components/ForumAnswerReader.tsx；T:forum-continuous.spec.ts、forum-entry.spec.ts；答案锚点深链、返回保位、无效/归档答案 |
| F09 | `/forum/:postId`（文章）；双 | 标题、正文富文本/图片/链接、作者、时间、标签、关联书籍、浏览量 | 社区→文章阅读器 | GET `/forum/posts/:id` 或 `/reading` | 待实现/待验收 | W:app/forum/[postId]/ForumPostClient.tsx；T:forum-articles.spec.ts；原生富文本安全渲染，不用WebView替页面 |
| F10 | 文章/答案来源信息；双 | 原作者、来源标题/URL、许可、原文/节选/导读、备选出处；保留URL锚点 | 阅读器→来源/外链 | ForumSource 数据 | 待实现/待验收 | W:components/ForumSourceCredit.tsx；T:forum-curation.spec.ts；来源链接仍定位原文，不误归属本站作者 |
| F11 | 文章/答案阅读设置；双 | 字号（持久化14–24范围，按钮16/18/20/22/24）、浅/深色 | 社区阅读器→设置 | 本地 lib/forum-reader-settings.ts + site theme | 待实现/待验收 | W:components/ForumAnswerReader.tsx、app/forum/[postId]/ForumPostClient.tsx；T:forum-refine.spec.ts；调字保位 |
| F12 | 文章/问题点赞；双、读 | 点赞/取消、数量与本人状态 | 帖子操作栏 | POST `/forum/posts/:id/like` {liked:boolean} | 待实现/待验收 | S:routes/forum-writes.js；T:forum-articles.spec.ts；明确期望状态避免 toggle 重试反转 |
| F13 | 答案赞同/取消；双、读 | 每答案独立计数，当前答案工具栏随阅读切换 | 答案操作栏 | POST `/forum/replies/:id/like` {liked:boolean} | 待实现/待验收 | W:components/ForumAnswerReader.tsx；T:forum-question.spec.ts；多答案切换不误点赞 |
| F14 | 回答评论列表；双、访可读 | 一级评论和二级回复、分页/继续加载、父子层级、作者信息 | 答案→评论 | GET `/forum/replies/:id/comments?page=&limit=100` | 待实现/待验收 | W:components/ForumReplyComments.tsx；S:app.js；T:reply-author.spec.ts；长线程/计数 |
| F15 | 评论回答/回复评论；双、读 | 评论内容≤2000 UTF-16，parentCommentId可选且只支持二级；反重复限流 | 答案评论→发表/回复 | POST `/forum/replies/:id/comments` {content,parentCommentId?} | 待实现/待验收 | S:routes/forum-writes.js；T:forum-question.spec.ts；跨回答父ID拒绝，失败留文 |
| F16 | 回答评论点赞；双、读 | 评论/子回复点赞与取消 | 评论行 | POST `/forum/comments/:id/like` {liked:boolean} | 待实现/待验收 | W:components/ForumReplyComments.tsx；S:routes/forum-writes.js；本人状态/重试 |
| F17 | “写回答”；双、读 | 纯文本转安全HTML，≤12000 UTF-16，成功进入新回答；失败保留 | 问题/答案→原生回答编辑器 | POST `/forum/posts/:id/replies` {content} | 待实现/待验收 | W:components/ForumAnswerComposer.tsx；S:routes/forum-writes.js；T:forum-question.spec.ts；服务端响应是存储DTO，需重新取展示DTO |
| F18 | `/forum/create?type=question`；双、读 | 标题≤120且问号结尾、正文≤30000、最多8标签每个20、预确认 | 社区→提问 | POST `/forum/posts` {title,content,type,tags,bookId?} | 待实现/待验收 | W:app/forum/create/page.tsx；S:routes/forum-writes.js；T:forum-question.spec.ts；重复请求429，不新增重复问题 |
| F19 | `/forum/create?type=article`；双、读 | 文章标题/正文/标签，提交确认、成功跳文章 | 社区→写文章 | 同 F18 type=article | 待实现/待验收 | T:forum-articles.spec.ts；输入边界/安全HTML/失败留文 |
| F20 | 详情“书友讨论”“发起讨论”；双 | 书籍相关问答/文章/答案卡片、更多、携带 bookId/bookTitle 发帖 | 书籍详情→讨论 | GET `/books/:id/discussions?page=`；旧 `/articles?page=`；POST `/forum/posts` bookId | 待实现/待验收 | W:components/BookArticles.tsx、BookDetailClient.tsx；T:book-articles-carousel.spec.ts；书籍关联与答案ID保留 |
| F21 | 文章/当前回答分享；双 | 系统分享/复制，链接保留具体 answer 位置 | 社区阅读器→分享 | 本地 canonical URL、answer参数 | 待实现/待验收 | W:components/ForumAnswerReader.tsx、app/forum/[postId]/ForumPostClient.tsx；T:forum-continuous.spec.ts；接收端打开同篇答案 |
| F22 | 论坛浏览统计；双 | 实际阅读上报，推荐事件失败不能阻断正文/点赞 | 社区阅读器后台事件 | POST `/forum/posts/:id/views` | 待实现/待验收 | W:lib/useForumView.ts；S:routes/forum-views.js；T:forum-performance.spec.ts；重复阅读去重/后台不刷数 |
| F23 | 线上论坛“推荐偏好”→个性化推荐；双、访/读 | 按本人书架/在读/有效阅读调整兴趣，可开启/关闭 | 社区→推荐偏好→个性化 | GET/PATCH `/forum/preferences` {enabled:boolean} | 待实现/待验收 | **线上957b99b** W:app/forum/page.tsx；本地未提交删入口，不缩范围；T:forum-polish.spec.ts；关闭后的推荐合同、跨端与游客隔离 |
| F24 | 推荐偏好→探索新兴趣；双、访/读 | “均衡探索/更多探索”切换，用于下一批推荐 | 社区→推荐偏好→探索程度 | PATCH `/forum/preferences` {exploration:balanced/more} | 待实现/待验收 | **线上957b99b** W:app/forum/page.tsx；S:services/forum-recommendations.js；切换持久化与新批次生效 |
| F25 | 推荐偏好→重置兴趣；双、访/读 | 重新学习阅读兴趣，保留关注与屏蔽 | 社区→推荐偏好→重新学习 | PATCH `/forum/preferences` {action:reset} | 待实现/待验收 | **线上957b99b** W:app/forum/page.tsx；server/tests/forum-recommendations.test.js；保留显式关注/屏蔽，不误全删 |
| F26 | 推荐偏好历史→恢复推荐；双、访/读 | 查看历次屏蔽/减少推荐项与原因，单项恢复 | 社区→推荐偏好→已减少推荐 | GET `/forum/preferences` rows；DELETE `/forum/preferences/:key` | 待实现/待验收 | **线上957b99b** W:app/forum/page.tsx；T:forum-polish.spec.ts；与短时撤销F05分开，旧偏好可恢复 |
| F27 | 推荐偏好历史→取消关注；双、访/读 | 查看关注作者/书籍，单项取消并刷新关注feed | 社区→推荐偏好→我的关注 | GET `/forum/preferences` rows；DELETE `/forum/preferences/:key` | 待实现/待验收 | **线上957b99b** W:app/forum/page.tsx；跨端取消与关注空态 |
| F28 | 线上论坛“换一批”；双、访/读 | 明确换批才更新推荐次序；清旧游标/阅读缓存，已请求tabs重新加载，滚动回顶 | 社区→换一批/明确刷新 | 同F01新无cursor请求；线上lib/forum-cache.ts renewForum | 待实现/待验收 | **线上957b99b** W:app/forum/page.tsx、lib/forum-cache.ts；被动返回不能自动换批，旧请求取消后不回灌 |

## 创作、草稿、发布与回收站

| ID | 网页入口/平台 | 实际行为与权限 | App 预期入口 | API/状态来源 | Android 状态 | 源码及验收证据要求 |
|---|---|---|---|---|---|---|
| W01 | 移底栏“创作”sheet；桌`/writer` | 访客登录引导；读者即能进入，列出本人已发布书+私密未发布文稿，20条/页 | 创作→我的作品 | GET `/writer/works?page=&limit=20`，X-Total-Count | 待实现/待验收 | W:components/MobileWriterDialog.tsx、WriterDashboard.tsx；T:creator-workspace.spec.ts、mobile-creation.spec.ts；不能按虚构writer角色阻止reader |
| W02 | 新建作品；双、读 | 新建私密文稿元资料，书名≤15码点、简介≤300、可选封面；不立即公开书 | 创作→新建作品 | PUT `/manuscripts/:key` multipart `manuscript` JSON {action:draft,revision:0,title,description,cover_image} | 待实现/待验收 | W:components/WorkCreator.tsx；server/tests/manuscript-routes.test.js；key16–128字符、最多50份、重复同内容幂等 |
| W03 | 编辑未发布作品；双、作 | 读取最新元资料，revision保护，只改书名简介封面，保留已导入章节 | 作品→编辑资料 | GET/PUT `/manuscripts/:key`，revision | 待实现/待验收 | W:components/WorkCreator.tsx；T:work-editing.spec.ts；409保留本地、拒绝用整本文稿覆盖章节 |
| W04 | 编辑已发布作品；双、作/管 | 书名/简介/封面；网页限制100/500码点，后端上限更宽 | 作品→编辑资料 | GET/PATCH `/books/:id` {title,description,cover_image} | 待实现/待验收 | W:components/WorkActions.tsx、WorkCreator.tsx；T:work-editing.spec.ts；修改不抹状态/章节/阅读量 |
| W05 | 换封面/移除封面；双、作/管 | JPG/PNG/WebP≤8MB、预览、移除；取消不改书；先上传再绑定 | 作品→封面 | POST `/upload/cover?purpose=book` multipart file；PATCH book或PUT manuscript | 待实现/待验收 | W:components/WorkCoverButton.tsx、WorkCreator.tsx；server/tests/upload-cover.test.js；归属/引用/上传成功绑定失败可恢复 |
| W06 | 公开/转私密；双、作/管 | 已发布作品切visibility；未发布文稿一直私密，隐藏公开按钮 | 作品→可见范围 | PATCH `/books/:id` {visibility:public/private} | 待实现/待验收 | S:services/work-access.js；T:work-editing.spec.ts；私密在搜索/榜/目录/书架/公共API均不可泄漏 |
| W07 | 删除作品；双、作/管 | 确认删除；已发布书软删；未发布文稿删除并退役其草稿/引用 | 作品→删除 | DELETE `/books/:id` 或 `/manuscripts/:key` | 待实现/待验收 | W:components/WorkActions.tsx；S:routes/content.js、manuscripts.js；T:work-editing.spec.ts；不能把“章节七天恢复”承诺套到未发布文稿删除 |
| W08 | 创作→草稿箱/已发布/回收站；双、作/管可管理书 | 以 `b_:id`、`m_:key` 引用；响应区分云草稿、已发布、移除/发布回执 | 作品→章节工作区 | GET `/writer/workspace/:reference?page=&search=&order=` | 待实现/待验收 | W:components/WritingWorkspace.tsx；S:routes/writing-workspace.js；T:writing-tabs.spec.ts；首次发布m引用仍可恢复剩余导入草稿 |
| W09 | 新建章节；双、作 | 分配未占用序号，本地草稿、标题/正文/字数 | 草稿箱→新建章节 | 本地draft；PUT `/writer/workspace/:ref/drafts/:draftId` | 待实现/待验收 | W:lib/writing-drafts.ts、components/WritingWorkspace.tsx；T:writing-workspace.spec.ts；删除章节号仍占用、不以列表长度当新序号 |
| W10 | 编辑/自动存草稿；双、作 | 本地先保存，按变更定时云同步（网页60秒），显式保存/离开保存，空闲不重复写 | 原生章节编辑器 | PUT `/writer/workspace/:ref/drafts/:id` {id,title,content,number,revision,…} | 待实现/待验收 | S:services/writing-drafts.js；T:writing-workspace.spec.ts；断网/关进程/本地存储失败不丢字 |
| W11 | 跨设备打开草稿；双、作 | 元数据与正文按需加载、cloudRevision并发保护、旧本地草稿迁移/冲突提示 | 草稿箱→打开 | GET `/writer/workspace/:ref/drafts/:id`；PUT revision | 待实现/待验收 | T:writing-workspace.spec.ts；server/tests/writing-workspace.test.js；旧设备不静默覆盖、身份隔离 |
| W12 | 已发布章节→编辑；双、作/管 | 读取正文建立修改稿，记录targetChapterId、baseUpdatedAt/legacyBaseHash，原章先保留 | 已发布→编辑修改稿 | GET `/chapters/:id`；草稿PUT | 待实现/待验收 | W:components/WritingWorkspace.tsx editPublished；server/tests/writing-workspace.test.js；原文并发更新后409不能覆盖 |
| W13 | 编辑器→下载备份；双、作 | 导出当前章节文本用于失败恢复 | 编辑器→导出TXT（SAF） | 本地当前文字 | 待实现/待验收 | W:components/WritingWorkspace.tsx backup；T:writing-workspace.spec.ts；存储/网络失败时仍可备份 |
| W14 | 单草稿发布；双、作 | 校验标题/正文/编号、先同步云草稿再发布；同draftId+hash重试返回同章；新文稿首次建公开书 | 草稿/编辑器→发布 | POST `/writer/workspace/:ref/publish` {id,title,content,number,targetChapterId?,baseUpdatedAt?,legacyBaseHash?,cloudRevision} | 待实现/待验收 | S:routes/writing-workspace.js；T:writing-workspace.spec.ts；响应丢失重试不双发，冲突保留草稿 |
| W15 | 序号冲突→重新编号；双、作 | 明确显示冲突，让新稿获得空闲序号后再发布 | 发布错误→重新编号 | workspace.maxNumber与publish409 | 待实现/待验收 | W:components/WritingWorkspace.tsx renumber；server/tests/writing-workspace.test.js；不覆盖其他章节 |
| W16 | 草稿管理批量发布；双、作 | 长按/菜单进入多选、全选、确认、顺序执行，成功项移除、失败项留存 | 草稿箱→批量管理→发布 | 逐条 W14 | 待实现/待验收 | T:writing-batch.spec.ts；部分成功、取消/重试、云revision冲突 |
| W17 | 草稿删除/批删；双、作 | 同步必要正文后进七天回收站；revision校验 | 草稿箱→删除 | POST `/writer/workspace/:ref/trash/drafts/:id/delete` {revision} | 待实现/待验收 | S:routes/writing-workspace.js；T:writing-batch.spec.ts、writing-trash-live-api.spec.ts；未同步文字不能直接丢弃 |
| W18 | 已发布章节分页/管理；双、作；管额外搜索/正倒序 | 每页50；编辑、单删/批删；全选只当前页 | 已发布章节→搜索/排序/管理 | GET workspace page/search/order；DELETE `/chapters/:id` | 待实现/待验收 | W:components/WritingWorkspace.tsx；T:work-editing.spec.ts、writing-batch.spec.ts；多页全选范围、目录版本更新 |
| W19 | 已发布章节删除；双、作/管 | 七天回收，保留章节号，阅读不再可用 | 章节→删除 | DELETE `/chapters/:id` → trashUntil | 待实现/待验收 | S:services/writing-trash.js；server/tests/writing-trash.test.js；删除与并发编辑/恢复保护 |
| W20 | 回收站列表/到期说明；双、作/管 | 已删除草稿/发布章分别标记，显示剩余恢复期，过期自动不可恢复 | 章节工作区→回收站 | GET workspace.trash（kind/sourceId/trashUntil） | 待实现/待验收 | T:writing-trash-live-api.spec.ts；server/tests/writing-trash-query.test.js；不能用客户端时间绕过期限 |
| W21 | 草稿单项/批量恢复；双、作 | 在七天内恢复草稿，revision递增，失败项保留 | 回收站→复原 | POST `/writer/workspace/:ref/trash/drafts/:id/restore` {revision} | 待实现/待验收 | server/tests/writing-trash.test.js；409/410、重复恢复、其他设备状态 |
| W22 | 已发布章单项/批量恢复；双、作/管 | 原ID/编号/正文恢复，目录与更新统计一致 | 回收站→复原 | POST `/chapters/:id/restore` | 待实现/待验收 | S:services/writing-trash.js；T:writing-trash-live-api.spec.ts；过期拒绝、R2正文可恢复 |
| W23 | 编辑器退出/系统返回；双 | 脏表单确认、保存进行中保护、返回草稿箱/创作中心、批量状态先退出 | 原生编辑器返回栈 | 本地+草稿状态 | 待实现/待验收 | T:mobile-writer-history.spec.ts、creation-opening.spec.ts；后台杀进程/导航切换不丢未发布文 |
| W24 | 作品封面/数据汇总入口；双、本人 | 总浏览量、最佳章节、日/周/月趋势（30日或12周/月）、更早/更近，可单书或本人全部 | 创作→作品数据 | GET `/writer/statistics?period=day/week/month&end=&work=b_:id或m_:key` | 待实现/待验收 | W:components/WriterStatistics.tsx；S:routes/writer.js；T:work-transfer.spec.ts；无数据与真实0不同、日期窗口、本人隔离 |

## 作品搬运与管理员业务

| ID | 网页入口/平台 | 实际行为与权限 | App 预期入口 | API/状态来源 | Android 状态 | 源码及验收证据要求 |
|---|---|---|---|---|---|---|
| M01 | 创作→作品搬运；双、读 | 书名/原作者、非空TXT≤30MB；创建投稿后传原始文件，原作者不冒充上传人 | 创作→搬运→系统文件选择器 | POST `/transfers` {title,author,filename,size} + Idempotency-Key 24位hex；PUT `/transfers/:id/file` octet-stream | 待实现/待验收 | W:components/WorkTransfer.tsx；S:routes/transfers.js；T:work-transfer.spec.ts；编码/长章/文件长度/中断重试 |
| M02 | 我的提交；双、读 | 列表分页、刷新、上传中/待审/收录中/通过/退回/过期状态、原因、通过后查看书 | 创作→搬运记录 | GET `/transfers?page=` → {items,hasNext} | 待实现/待验收 | W:components/WorkTransfer.tsx；server/tests/transfers.test.js；只能本人、3份/24小时与5份待处理等限制可解释 |
| M03 | 搬运审核页签；双、管 | 待审/收录中队列、投稿人、分页、刷新 | 管理→搬运审核 | GET `/transfers?review=true&page=` | 待实现/待验收 | S:routes/transfers.js；T:work-transfer.spec.ts；reader403，待审不会公开 |
| M04 | 投稿预览；双、管 | 纯文本预览每段12000 code units、从头/下一段、章数/字数、同名同作者重复提示 | 管理→投稿→预览 | GET `/transfers/:id/preview?offset=` → text,nextOffset,duplicates | 待实现/待验收 | W:components/WorkTransfer.tsx；server/tests/transfers.test.js；不能执行上传HTML；重复不可覆盖书 |
| M05 | 退回投稿；双、管 | 必填≤500原因；pending才可退回，清理投稿文件、释放容量 | 管理→投稿→退回 | POST `/transfers/:id/reject` {reason} | 待实现/待验收 | S:routes/transfers.js；server/tests/transfers.test.js；状态竞争409/不可退回importing |
| M06 | 审核通过/继续收录；双、管 | 有界分批导入、持久processed断点、未完成私密，完整校验后一次公开；重试不双建 | 管理→投稿→收录/继续 | POST `/transfers/:id/approve` {}，循环直到accepted | 待实现/待验收 | W:components/WorkTransfer.tsx decide；server/tests/transfers.test.js；网络中断/后台恢复、同名保护、实际长章完整 |
| M07 | `/writer`→用户管理；主要桌入口，管理业务须App可达 | 管；用户名/邮箱搜索、15条分页、角色/禁用状态、活跃分及阅读上传统计 | 我的→管理→用户 | GET `/admin/users?search=&page=&limit=`；X-Total-Count | 待实现/待验收 | W:components/WriterDashboard.tsx；S:app.js；T:registration-admin.spec.ts；搜索转义、权限隔离 |
| M08 | 用户管理→封禁/解封；管 | 确认、不能封自己；提升authVersion并撤销所有会话 | 管理→用户→封禁/解封 | PATCH `/admin/users/:uid/ban` {isBanned:boolean} | 待实现/待验收 | S:app.js；server/tests/security.test.js；App/Web并行会话即时失效、不能保留旧Bearer权限 |
| M09 | `/writer`→书籍总编辑；主要桌入口、管 | 热门书列表及书名/作者搜索，选书进入共用资料/章节编辑器 | 管理→书籍 | GET `/books?orderBy=views…` 或 `?q=…`，编辑同W04/W08等 | 待实现/待验收 | W:components/WriterDashboard.tsx；T:work-editing.spec.ts；必须在App提供admin入口，不因移动网页隐藏侧栏漏功能 |
| M10 | 总编辑→管理他人作品；管 | 编辑资料/换封面/私密/删除、章节搜索/编辑/删除/恢复 | 管理→书籍→管理工作区 | 同W04–W08、W12、W18–W22 | 待实现/待验收 | S:services/content.js lockBook、routes/writing-workspace.js resolve；T:work-editing.spec.ts；admin跨所有者访问不改变原作者身份 |
| M11 | 管理员段评删除；双、管 | 可删除他人违规段评；普通读者仅本人 | 阅读器段评→管理删除 | 同 C10 | 待实现/待验收 | server/tests/paragraph-comments.test.js；正/负权限用例 |

## Android 首版明确增加的能力与跨模块验收

| ID | 范围/入口 | 预期实际行为 | API/存储差异 | 状态 | 必需验收证据 |
|---|---|---|---|---|---|
| X01 | 原生登录/设备会话 | 短期access、轮换refresh、Keystore支持加密存储；退出/改密/封禁撤销；保持网页Cookie/CSRF | 基线无原生Bearer合同；不能用存量前端偶发Authorization写法当后端支持证明 | 后端与数据层合同/真实Keystore检查通过；完整账号UI待验收 | 令牌过期/刷新重放/撤销/跨账号、网页旧合同回归 |
| X02 | 原生全文/元数据仓库 | Room+私有正文文件+DataStore，离线优先；正文hash验证后原子落盘，目录版本一致 | 当前chapterResponse主动剔除contentKey/contentSha256，必须补公开内容版本/摘要而不泄R2内部凭据 | 待实现/待验收 | 断电/中断写/坏hash/磁盘不足/版本更新，旧正文与新目录不混用 |
| X03 | 书籍/章节离线下载 | 用户主动下载、进度、暂停/取消/重试/恢复、离线可读、存储管理；自动缓存与下载分别淘汰 | 网页无离线下载业务API；可复用有界正文读取但需版本合同及队列 | 待实现/待验收 | 断网/后台/杀进程/网络约束、未完整章节不标完成 |
| X04 | 精确跨端续读 | bookId+chapterId+contentVersion+paragraphKey+UTF-16 charOffset；最近读与最远读分开，重读合法 | 现history无章内锚点/修订号/operationId；网页与App共同升级 | 待实现/待验收 | Web→App→Web、字号/旋转重排、正文变更、旧离线设备冲突、不匹配明确回退 |
| X05 | 书架/进度离线同步 | 操作ID、设备ID、服务端revision、删除标记；可重放队列、身份隔离 | 现书架添加/删除幂等但无增量/tombstone合同，不能只按客户端上传时间覆盖 | CAS/幂等/墓碑及Room冲突测试通过；端到端恢复待验收 | 重复同步、离线删除后旧设备上线、两端并发、恢复队列 |
| X06 | 分享接收/App Links | 正规书籍/章节/作者/用户/论坛问题/文章/答案链接冷暖启动可达 | 网站verified App Links association待补；answer等定位参数保留 | 待实现/待验收 | 安装前后、无登录/过期登录、无效链接、系统Back |
| X07 | 原生可访问性 | 阅读正文可被TalkBack读取、段落操作语义、选择复制、焦点顺序、大字号/对比度 | StaticLayout/Canvas不能因自绘丢语义；复制为技术方案要求 | 待实现/待验收 | TalkBack实测、外接键盘/平板、200%字体、按钮触区 |
| X08 | 生命周期/性能 | 前后台/旋转/进程死亡恢复；长章后台排版可取消、有界邻章缓存；低配流畅 | 独立reader模块、Room/StateFlow | 待实现/待验收 | release Macrobenchmark/内存/帧耗时、低端真实设备；模拟器不能算真机 |
| X09 | 安装/升级与发布 | 独立签名release APK、版本升级保留数据、说明和证据 | 私密签名密钥不提交；原生依赖版本由主任务固定 | 待实现/待验收 | 签名校验、干净安装/覆盖升级、回归与可定位APK |
| X10 | 故障和权限一致性 | 401/403/404/409/410/413/429/503区分，保留输入、显式重试；私密/已删内容不因缓存穿透 | 现返回多为{error}字符串，需兼容的稳定错误码/合同 | 待实现/待验收 | API合同测试、真实写失败、限流/维护、跨账号缓存清理 |

## API 合同风险与实现注意（不得省略）

1. **认证路径未统一原生化**：`server/security.js` 是 HttpOnly Cookie/Origin/CSRF，`web-next/lib/api.ts` 中 `x-user-id` 及旧token读取不是可信权限来源。原生认证必须进入同一 `auth.authenticate`/`optionalUserId`，否则公开页面中个性化状态、私密书访问、论坛推荐也会丢身份。推荐游客使用独立服务端cookie/identity，首个身份初始化后再发并行签名回执，切换账号必须清请求与缓存。
2. **DTO 形状混杂**：Book有id/_id及createdAt/created_at、cover_image/coverImage等历史字段；章节 `reader=1` 返回 `{book,chapter}`，缺该参数时返回chapter本体；navigation=1才有previousId/nextId/chapterIndex/chapterTotal/catalogVersion。论坛写响应是存储对象，读响应才是votes、hasLiked、author、time显示DTO。实现显式适配，不把接口泛型声明当服务端事实。
3. **分页并非一类**：books/library/writer/admin依赖X-Total-Count；reviews依赖X-Next-Cursor等头；review replies是body.cursor；forum feed是nextCursor；transfers是hasNext；catalog是offset/window/version。不能在一页结果等于limit时假报全集，也不能从重复页构建假目录。
4. **正文哈希目前不对外提供**：`server/services/chapter-storage.js:chapterResponse` 会删除contentSha256/contentKey；内联与R2共存。App下载校验需要稳定公开hash/version，必须由服务端正文规范计算，不能以updatedAt/目录版本假作不可变正文hash；段评写入也会提升book.writeVersion，所以它不等于正文版本。
5. **段落身份必须逐字兼容**：`shared/reader-paragraphs.mjs` 对CRLF/LF/CR分行、trim、过滤空段、前三个非空段内去重复章标题（忽略空白与中英文括号）；按UTF-16 charCodeAt进行FNV式32位a和djb式32位b运算，生成16位小写hex再加同hash出现序号。Kotlin要用溢出Int和无符号hex匹配，不换成SHA、不按Unicode码点循环。anchor偏移统一UTF-16并对emoji代理对边界规范化，测试中文/emoji/重复段/标题变更。
6. **写操作幂等形式不同**：books创建Idempotency-Key允许16–128字母数字下划线横线；transfers要求24位hex；段评/书评回复requestId是16–64字符；workspace以draftId+内容hash+云revision；forum发布只有近期重复检测，没有真正回执型幂等。不应自动重试任意POST后声称恰好一次，必要时演进合同。
7. **文本长度单位不同**：注册密码受UTF-8 byte≤72；书评140/书评回复1000采用码点；段评1000与论坛限制采用UTF-16长度；新文稿元资料15/300码点；网页编辑已发布书100/500码点比服务端200/5000 UTF-16限制窄。原生UI保留现行用户边界，服务端仍为最终裁决。
8. **草稿/发布不能走旧简化接口替代**：应复用workspace revision、publish回执、baseUpdatedAt与七天回收规则。直接PATCH `/chapters/:id`没有相同编辑冲突合同；直接POST `/books`也不是现行“新建私密文稿”流程。批量操作要记录每项结果，不能一次失败后重发已成功项的新ID。
9. **多种“作者”语义**：账号作者、导入AuthorProfile、论坛来源原作者及实际上传账户互不等同。author_profile_id/canonicalId/来源host+author必须保留，不能按显示名自动合并为同账号，也不能把作品搬运变成所有权转让。
10. **渲染与外链**：论坛内容为清洗HTML，原生应支持实际允许的段落、标题、列表、强调、链接、引用、图片；来源URL中的fragment具有业务定位含义。链接需要合理外部Intent，但站内业务须原生完成。
11. **权限实时变化与缓存**：私密作品只本人或管理员可读，公开用户列表不能泄漏；章被删、作品私密、账号封禁后既有缓存如何失效需明确（主动离线下载的访问策略也需约定）。账号退出时私人草稿/书架/推荐不可进入另一账号可见状态。
12. **推荐UI与工作区测试冲突**：工作区 `forum-recommendations.spec.ts` 断言没有“推荐偏好/换一批”按钮，但开工线上957b99b仍有这些操作；`forum-polish.spec.ts` 的对应入口与线上一致。本清单以线上版本为准，F23–F28全部属于1.0，不得依据未提交删除或新测试缩减范围。

本轮开发增量（非开工已完成能力）：主任务已建立 `android/contracts/reading-progress.md`，拟增 `GET/PUT/DELETE /api/v1/me/reading-progress/:bookId`（baseRevision、operationId、deviceId、position、furthest、deleted），正文增 `contentVersion=SHA256(原始UTF-8正文)` 与 `paragraphVersion:1`。主任务报告后端测试通过，**网页锚点采集、Android消费和跨端端到端仍待实现/待验收**；因此X02/X04/X05没有标通过。后续以该合同实现并保留本文件的开工差异事实。

## 有意不照搬/须区分的存量入口

| 项目 | 现状证据 | 处理 |
|---|---|---|
| `/authorsList` | W:app/authorsList/page.tsx 仅“所有作者列表（开发中）”与返回书库 | 不是已实现作者总表；D09真实作者主页必须实现。占位不能作为App已通过功能 |
| 原稿整本导入/一键整本发布 | S:routes/manuscripts.js 当前只允许元资料，非空chapters被拒；server/tests/manuscript-routes.test.js专门覆盖退休旧操作 | 不复活旧接口；现行TXT搬运审核M01–06和旧导入草稿恢复W03/W08必须保留 |
| `/admin/check-sync`、`/admin/upload-book`，含missingOnly分支 | S:routes/import.js、library-import.js；供采集/运维导入凭据使用 | 不是当前网页用户管理按钮，也不向App内置导入密钥；保留后端兼容。若线上核对发现真实管理员网页入口，补入范围 |
| `/books/:id/restore` | S:routes/content.js为admin恢复整本书；现行WriterDashboard/WorkActions未见恢复整本书入口 | API存量，无现行网页恢复入口；不能与现行章节回收站混同。客户端无需假造已存在业务，可另列后续增强 |
| 工作区论坛偏好UI删除 | 开工未提交改动，线上957b99b仍存在设置/历史/换一批 | 不纳入基线删除；原生实现必须覆盖F23–F28 |
| `/users/:id/review-sources` | 仍有API；当前PublicUserProfile未使用来源列表，展示主页与最近读 | API存量；保留实际短评内容和论坛来源展示，不宣称当前公共主页有完整来源管理 |
| 用户名/邮箱修改、忘记密码、注销账号、社区删帖/编辑、书评删回复、通知、付费、TTS | 本轮路由/页面无有效对应操作 | 不能猜成现有功能；不以按钮占位交付。用户明确新增时再纳入 |
| 影子登录、破坏性清章 | S:app.js两接口固定410“已停用” | 不做App管理功能、不绕开服务端禁用 |
| sitemap/robots/SEO、运维健康/统计观察、爬虫工具、部署、备份/R2工具 | 路由及脚本基础设施 | 不照搬为App页面；必要服务保护与兼容仍需回归 |
| QQ/UC浏览器分享SDK、浏览器历史API、CSS动画实现 | 网页平台实现细节 | 用Android分享/原生导航/动画达成功能；不要求复制浏览器SDK |

## 基线覆盖与验收登记规则

本轮已逐类检查 `web-next/app` 的全部业务页面（首页、登录、注册、搜索、排行、作者、作者占位、书籍、章节、书架、本人/公开主页、论坛首页/文章/问题/创建、writer），及其有交互组件；路由盘点覆盖 `server/app.js` 与 `server/routes/{auth,reading,book-detail,catalog,library,content,review-reactions,review-replies,paragraph-comments,forum-writes,forum-views,forum-recommendations,writer,writing-workspace,manuscripts,transfers,media,import,library-import,traffic-observation}.js`。公共/私密访问另读 `services/work-access.js`。此清单是有源码依据的初始范围固定，不替代线上差异核对。

每项通过时记录：实现路径/提交、设备与Android版本、账号角色（不可写凭据）、验证日期、测试命令或手工步骤、实际结果、截图/日志路径；写入测试用数据ID与清理结果。编译成功只能证明可构建，不能把该行改为业务通过。网站旧测试须先核对当前合同；本文件全项通过、release可安装且真机等完成条件满足后，方可宣告首版完成。
