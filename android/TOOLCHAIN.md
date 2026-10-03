# Android 构建工具链

本工程与网站独立构建，最低 Android 8/API 26，compileSdk/targetSdk 36。

## Windows 模拟器不弹窗约束

统一运行 `node --require D:/Apps/Codex/home/tools/windows-hide.cjs android/tools/emulator.cjs`。该命令保留监督进程，调用方将它作为后台任务运行；不要添加detached/unref或把子进程stdout/stderr改成继承的数字文件句柄。

2026-10-03用户实际遇到旧启动链弹出的Windows Terminal。已改成直接运行SDK的 `qemu/windows-x86_64/qemu-system-x86_64-headless.exe`，显式补齐launcher目录和DLL搜索路径，以 `detached:false`、`windowsHide:true`、ignore/pipe标准流启动，再由Node写日志。backend不存在时失败，不回退到会重新创建控制台的wrapper。依据：[Android launcher源码](https://android.googlesource.com/platform/external/qemu/+/emu-master-dev/android/emulator/main-emulator.cpp)、[libuv Windows进程创建条件](https://github.com/libuv/libuv/blob/v1.x/src/win/process.c)。

实测新链仅有Node→headless qemu，API36完成启动；55秒、478次只读窗口扫描未发现任务可见窗口或任务窗口抢焦点，证据 `.runtime/task-artifacts/android-v1/emulator-background-window-verified.json`。启动配置回归入口 `node --test android/tools/emulator.test.cjs`。日志 `emulator-runtime.log`，进程状态 `emulator-process.json`。GPU通过白名单 `JIUTIAN_GPU`选择，与无窗口要求独立。

## 固定依赖

- JDK 17、Gradle Wrapper 8.13（distribution SHA-256 固定）、AGP 8.13.2。
- Kotlin/Compose compiler 2.2.20、KSP 2.2.20-2.0.4。
- Compose BOM 2025.09.01；其余版本集中在 `gradle/libs.versions.toml`，不使用 alpha、动态版本或 SNAPSHOT。
- 四模块：`:app`、`:core:data`、`:core:ui`、`:feature:reader`。Room schemas 纳入版本管理，数据库变更须显式迁移。

AGP 8.13 官方兼容矩阵要求 Gradle 8.13、JDK17，支持 API36.1；采用这一已发布稳定组合，避免首次交付同时迁移 AGP9 构建行为。[官方兼容矩阵](https://developer.android.com/build/releases/agp-8-13-0-release-notes)、[Gradle8.13](https://docs.gradle.org/8.13/release-notes.html)。

## Windows 后台构建

安装位置独立于 Git：

- JDK：`D:/Apps/Android/jdk-17.0.20.1+1`（Microsoft OpenJDK17 ZIP，官方 SHA256 校验）。
- SDK：`D:/Apps/Android/sdk`，已安装 commandline-tools、platform-tools、platforms;android-36、build-tools;35.0.0。
- Gradle 缓存：`D:/Apps/Android/gradle-cache`。

来源：[Microsoft OpenJDK](https://learn.microsoft.com/java/openjdk/download)、[Google SDK CLI](https://developer.android.com/studio#command-tools)。不更改全局 JAVA_HOME、PATH 或 Windows 临时目录。

从仓库根目录运行：

```powershell
node --require D:/Apps/Codex/home/tools/windows-hide.cjs android/tools/build.cjs :app:assembleDebug
node --require D:/Apps/Codex/home/tools/windows-hide.cjs android/tools/build.cjs testDebugUnitTest lintDebug
```

脚本加载项目 `tools/test-env.cjs`，直接隐藏启动 Java，使用 Gradle Wrapper，不经 npm/cmd 启动链。日志保存 `.runtime/task-artifacts/android-v1/gradle-*.log`，临时文件使用 `.runtime/test-tmp`。可用 `JAVA_HOME`、`ANDROID_HOME`、`GRADLE_USER_HOME` 覆盖本机默认路径。

其他环境安装 JDK17、Android SDK36 后，设置 JAVA_HOME 和 ANDROID_HOME，执行 `./gradlew assembleDebug`。`local.properties` 和构建输出不进入 Git。

## 无头模拟器

AVD 名称 `jiutian_api36`，系统镜像 `system-images;android-36;google_apis;x86_64`，AVD 数据独立保存在项目 `.runtime/android-emulator`。启动入口：

```powershell
node --require D:/Apps/Codex/home/tools/windows-hide.cjs android/tools/emulator.cjs
```

默认启用 `-no-window -no-audio -no-boot-anim -no-snapshot`，使用软件 GPU 和 2GB RAM。日志位于 `.runtime/task-artifacts/android-v1/emulator-runtime.log`。不要在后台任务中去掉隐藏选项或启动可见 Android Studio。Windows 虚拟化配置需要系统权限或重启时记录为验收限制，不自动更改主机设置。

本机加速检查结果：WHPX(10.0.26200) installed and usable。2026-10-03 用户确认没有多余安卓手机，取消真机验收要求，改以无头模拟器作为本次设备验收环境；模拟器结果不可标注为真机通过。

基础工具链验收（2026-10-03）：`:app:assembleDebug` 成功，101 个任务；API36 AVD `sys.boot_completed=1`，`adb install -r` 成功，空入口 Activity 启动 `Status: ok` 且进程存活。记录见 `.runtime/task-artifacts/android-v1/emulator-verified.json` 和 `gradle-2026-10-03T15-31-59-509Z.log`。首次 AVD 冷启动约192秒、初次空入口应用启动约10.6秒，仅证明安装运行能力，不是性能验收。

## 构建与发布边界

debug APK 位于 `app/build/outputs/apk/debug/app-debug.apk`。release 默认启用 R8，不自动复用 debug 签名；正式签名配置由发布阶段单独提供，密钥和口令不进入仓库。工程编译成功只证明构建可用，业务、无障碍、模拟器性能和签名发布仍需各自验收。

## 隔离写入验收

`android/tools/test-server.mjs` 创建全新的项目内 SQLite TestDatabase，只监听 `127.0.0.1:5081`；邮件捕获、外部服务禁用。种子只有专用 reader/author/admin 账号、六章长文、短评、文章/问答。显式传 `--large-catalog` 才额外创建两万章书籍。Node20会自动用本机Codex捆绑Node22+，不使用线上数据库。

```powershell
node --require D:/Apps/Codex/home/tools/windows-hide.cjs android/tools/test-server.mjs
node --require D:/Apps/Codex/home/tools/windows-hide.cjs android/tools/build.cjs :app:connectedDebugAndroidTest '-PjiutianTestApiBase=http://127.0.0.1:5081' '-Pandroid.testInstrumentationRunnerArguments.class=com.jiutian.reader.AppIsolatedWriteTest'
```

测试前隐藏调用 `adb reverse tcp:5081 tcp:5081`，并清理仅模拟器中的测试App数据以隔离旧身份。随机凭据位于 `.runtime/task-artifacts/android-v1/test-fixture-private.json`，不输出、不提交；测试APK专用资产由脚本写入被Git忽略的 `app/build/generated/androidTestFixture`，正式APK不包含这些资产。测试服务器停止后清理其自己创建的SQLite文件，不动线上数据。

只有debug变体可通过 `jiutianTestApiBase` 指定loopback端点，允许的明文域仅 `localhost/127.0.0.1`；release编译固定HTTPS线上域名。PowerShell中带点号的Gradle `-P...` 参数必须完整单引号引用，避免被拆成任务名。

本机为16GB内存，Gradle现固定最多2个worker、关闭跨模块并行、Kotlin使用Gradle进程内编译，最大Java堆2GB。此前同时运行模拟器、网页开发服务、并行lint/test时发生Windows原生malloc失败；此配置用于约束构建内存，不降低测试覆盖。

`benchmark` 变体继承正式版R8规则和独立生产签名，`debuggable=false`，仅该变体与release声明 `profileable android:shell=true`。性能测试可给benchmark传同一严格loopback属性；其网络策略仍仅放行localhost/127.0.0.1。正式release永远固定公网HTTPS、不读取该属性作端点。benchmark用于可重复的隔离数据性能测量，不作为公网交付APK。构建此变体同样由签名工具传入环境变量，禁止用debug签名替代正式条件。

集成验收记录：`gradle-2026-10-03T16-44-48-659Z.log` 公网只读Compose设备测试3/3通过（每日精选→详情→正文→系统返回、真实搜索→详情返回保留关键词、访客登录入口返回），同轮论坛Room/富文本单测2/2通过；`gradle-2026-10-03T16-12-51-427Z.log` 的core:data真实设备Keystore/篡改/SQLite重开3/3通过。后续业务写入测试仅运行5081隔离端点，不能用这些记录替代尚未完成的全表功能或性能验收。

`AppOfflineFlowTest` 与 `tools/offline-restart.cjs` 是两阶段设备验收入口：先以loopback配置assembleDebug/assembleDebugAndroidTest，脚本直接安装这两个保留在构建目录中的APK、清理仅测试App数据，运行真实WorkManager下载/暂停/恢复；host再force-stop App、关闭模拟器wifi/data，重新启动独立instrumentation验证文件哈希、离线目录、持久设置/标记/锚点及正文原生显示，最后清理下载。脚本finally恢复wifi/data与adb reverse。它拒绝非emulator序列号并拒绝把skipped instrumentation算通过，日志和结构化结论写任务目录。此入口新增时尚未执行，不代表已经通过强杀/离线验收。
