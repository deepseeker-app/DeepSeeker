# DeepSeeker 桌面端

[English](README.md) | 中文

桌面应用负责监管现有的回环 Web Host；窗口关闭后，系统托盘继续持有 Host 的生命周期。

## 开发

安装依赖后，使用单一桌面开发命令。该命令会先构建 Host 与客户端包、Web 前端和 Electron main 进程，再启动应用：

```sh
pnpm run dev:desktop
```

关闭窗口会隐藏窗口。通过托盘菜单恢复窗口或退出应用。显式退出会等待 Host 进程停止，并在 Host 的有界宽限期结束后升级终止行为。

桌面应用只接受 `dsh web` 为 `127.0.0.1` 或 `localhost` 输出的就绪 URL。页面导航限制在该来源；HTTP 和 HTTPS 链接交给系统浏览器打开。

原生窗口外观按宿主平台区分。macOS 使用无边框内嵌标题栏、交通灯和侧栏 vibrancy；收起侧栏宽 90px，其中的控件水平居中，最上方控件在交通灯下方与展开态 logo 行对齐。Windows 保留系统边框、阴影、缩放与 Snap 行为以及 Windows 11 圆角，同时用隐藏标题栏把原生窗口按钮放入 Session header 首行；Windows 侧栏不预留交通灯区域。该行的空白部分可拖动，控件仍可点击；没有 Session header 时，常驻拖拽带覆盖同一行。Windows acrylic 和 macOS vibrancy 只透过侧栏，会话区与详情区保持不透明。Linux 使用无边框窗口和不透明侧栏降级样式。

## 配置方案

托盘菜单里有“配置方案”和一个轻量管理窗口。内置的“默认”方案继续使用普通 `$DSH_HOME`（未配置时为 `~/.dsh`）。在管理窗口里新建的每套方案都有独立 Harness 数据目录，放在 Electron 的私有用户数据目录下。模型设置、密钥、插件、会话和 profile patch 都分开保存。方案名称可以修改。不再使用的自建方案，经过系统确认后可以删除，独立 Harness 目录也会一起删掉。内置“默认”和当前正在使用的方案不能删除。

切换时不会直接停掉当前 Host。DeepSeeker 会先针对候选数据目录，在独立的有界进程里运行 `dsh --profile web --dump-config`。检查失败或超时，当前窗口和 Host 都不动。检查通过后，待切换状态才会原子写入，然后 Electron 走原有的 Host 优雅退出流程重启。新方案必须等回环 Host 就绪且页面加载完成后，才会成为“上一次可用配置”。如果真实启动仍然失败，启动器会退回之前可用的方案。

## 桌面终端

托盘里的“高级功能 > 桌面终端”会打开一个本机 Shell，供需要直接输入命令的用户使用。终端使用沙箱 renderer、独立 preload、xterm 和惰性加载的 `node-pty`。PTY 模块缺失或损坏时，主产品仍然可以启动。Shell 从打包 Host 的工作目录打开，只接收当前方案的 `DSH_HOME`；继承的密钥和其他 `DSH_*` 变量不会传入 Shell。

Windows 会依次寻找 PowerShell 7、Windows PowerShell 和 `cmd.exe`；macOS 与 Linux 使用可用的 POSIX Shell。main 进程会限制输入大小和终端尺寸。关闭终端时先请求 Shell 退出，超时后升级终止；Windows 会清理完整进程树。退出 DeepSeeker 时也会等待终端清理，最后还有强制停止兜底。

## 更新

打包后的 macOS 和 Windows 版本会在启动 60 秒后检查 DeepSeeker 的 GitHub Release，之后每六小时检查一次，每次最多等 15 秒。自动检查只更新托盘并显示一次系统通知，不会自己下载。用户点击托盘里的“检查更新”后，应用会显示结果；确认后才开始下载。

下载器只接受本仓库的 GitHub Release 地址，跳转目标也必须属于 GitHub。安装包最大 1 GiB；等待响应或下一块数据超过 30 秒时，下载会取消。文件先写入私有用户数据目录，再核对 Release 标记的大小、GitHub 提供的 SHA-256 以及 DMG、ZIP 或 PE 文件头。超时会删掉临时文件。没有 GitHub 摘要的产物只会保留 Release 页入口，应用不会自动下载。全部通过后才发布完整文件，托盘会显示整数下载进度。macOS 打开校验后的 DMG 或 ZIP，不关闭正在运行的应用。Windows 在启动 NSIS 安装器前会再问一次。请求、校验、打开或启动安装器失败时，当前应用继续运行。

## 打包

本地打包命令会执行完整的仓库构建，并为 Host 暂存封闭的生产依赖树。暂存使用 pnpm legacy deploy；该命令会临时改写工作区的依赖布局，所以无论暂存成功还是失败，脚本都会用冻结锁文件重新连接源码工作区，再返回结果。macOS 会先在系统临时目录生成应用，完成并验证 ad-hoc 签名，再把 ZIP 和流式计算的 `.sha256` 校验文件放进 `apps/desktop/dist`，避免外置硬盘产生的 AppleDouble 文件破坏 Electron 打包。ad-hoc 签名用于确认包结构完整，不包含 Developer ID，也没有经过 Apple 公证。无需另行手动构建：

```sh
pnpm run package:desktop
```

ZIP 里的应用通过 Electron 的 Node 模式，在独立进程内运行已暂存的 `@deepseek-ai/dsh` CLI。应用因此保留受 supervisor 管理的 Host 生命周期，无需携带第二个 Node 可执行文件。如果暂存的 CLI 入口或 Web 前端入口缺失，`afterPack` 检查会在压缩前拒绝该产物。macOS 和 Windows 都使用受跟踪的 `apps/desktop/build/icon.png` 原始文件；仓库不预处理图标，也不提交平台专用图标变体。

### Windows NSIS 安装器

在 Windows 上构建 x64 单用户 NSIS 安装器：

```sh
pnpm run dist:win:desktop
```

产物固定为 `apps/desktop/dist/DeepSeeker-windows-x64-setup.exe`。官网可以一直使用 `/releases/latest/download/DeepSeeker-windows-x64-setup.exe`，不用把版本号写死。`.github/workflows/release-windows.yml` 会在推送 `v*` tag 或手动指定 tag 时运行。它会先确认 tag 与 `apps/desktop/package.json` 的版本一致，再在 `windows-latest` 上构建、检查 PE 文件头、生成 SHA-256，最后把两个 Windows 文件挂到 GitHub Release 草稿。等 macOS ZIP 和 sidecar 上传后，四个文件齐全才公开草稿。Pages workflow 还会检查两个 sidecar 的文件名和 GitHub 摘要，对不上就不发布官网。这些 workflow 只使用仓库自带的 `GITHUB_TOKEN`；安装器未签名时不需要额外 secret。

### 已签名的 macOS DMG

macOS 发布命令要求构建用户的 Keychain 中安装有效的 `Developer ID Application` 身份，且证书与私钥必须同时存在。它还需要一组完整的公证凭据。Keychain profile 可以避免应用专用密码进入仓库或 shell 历史记录：

```sh
xcrun notarytool store-credentials "dsh-notary" --apple-id "<Apple ID>" --team-id "<Team ID>"
```

`notarytool` 会交互式请求秘密。使用已存储的 profile 构建已签名、开启 hardened runtime 且已公证的 DMG：

```sh
APPLE_KEYCHAIN_PROFILE=dsh-notary pnpm run dist:mac:desktop
```

现有秘密文件可以提供 `MAC_CERT_P12_BASE64`、`MACOS_SIGN_IDENTITY`、`CSC_KEY_PASSWORD`、`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD` 和 `APPLE_TEAM_ID`，无需把证书导入持久 Keychain：

```sh
node --env-file=/absolute/path/to/macos-signing-secrets.env --import tsx apps/desktop/scripts/release-mac.ts
```

Electron Builder 会把该 Base64 PKCS#12 证书导入临时 Keychain，并在构建结束时删除。wrapper 不会把签名和公证变量传给仓库构建与运行时暂存子进程，只会将其传给 Electron Builder。秘密文件及其路径都不会受版本控制。

发布预检查会在仓库构建前运行。如果宿主不是 macOS、所提供身份不是 `Developer ID Application` 身份、签名凭据不完整、签名发现被禁用，或公证凭据缺失或不完整，预检查都会失败。未提供 PKCS#12 凭据组时，Keychain 中必须存在带私钥的可用 `Developer ID Application` 身份。除 Keychain profile 外，该命令也接受完整的 Apple ID 凭据组（`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD` 和 `APPLE_TEAM_ID`），或 App Store Connect API 密钥组（`APPLE_API_KEY`、`APPLE_API_KEY_ID` 和 `APPLE_API_ISSUER`）。

构建成功后，挂载生成的 DMG，再验证其中应用的签名、Gatekeeper 评估和已装订的公证票据：

```sh
DMG_PATH="$(find apps/desktop/dist -maxdepth 1 -type f -name '*.dmg' -print -quit)"
MOUNT_POINT="$(mktemp -d)"
hdiutil attach "$DMG_PATH" -mountpoint "$MOUNT_POINT" -nobrowse -readonly
APP_PATH="$MOUNT_POINT/DeepSeeker.app"
codesign --verify --deep --strict --verbose=2 "$APP_PATH"
spctl --assess --type execute --verbose=4 "$APP_PATH"
xcrun stapler validate "$APP_PATH"
hdiutil detach "$MOUNT_POINT"
rmdir "$MOUNT_POINT"
```

## 已知限制

首个桌面装配使用回环 HTTP Host。renderer 和 Host 协议保持不变，因此后续可替换为 GUI 架构预留的 IPC carrier，而无需改动产品功能。

Windows 已有 x64 NSIS 安装器和 Release workflow，Authenticode 签名还没做。Linux 仍只生成未封装应用。桌面终端每次只运行一个本机 PTY，不承担远程 Shell 和终端方案保存。Windows ConPTY 的最终交互验收还需要 Windows runner 或实机。

## 模型体验

桌面壳不会增加模型可见输入。复用的 Web profile 继续持有现有的 Web 运行时上下文。
