# Agent Note: 桌面配置方案与经过校验的 GitHub Release 更新

Status: implemented

[English](2026-08-16-desktop-configuration-schemes-and-release-updates.md) | 中文

## 问题

DeepSeeker 第一个桌面版本只复用一套 Web profile，没有 Windows 安装器，也没有更新入口。普通用户想把工作和个人的密钥、模型、插件、会话分开，只能自己改 Harness 文件。公开版本修好问题后，用户还得自己找安装包并替换应用。切换配置或更新失败，也不能把正在正常运行的 Host 停掉。

## 决策

Electron 桌面壳在模型不可见的 Harness 树外管理“配置方案”。内置的“默认”方案继续使用普通 Harness home。用户新建的每套方案会拿到一个不透明 UUID 目录，并在 Electron 用户数据目录下使用独立 Harness home；用户填写的名称不会进入文件路径。方案元数据和选择状态使用私有目录、私有文件、有界读取与原子替换。中央状态文件损坏时，还能从每套方案自己的元数据找回名称。

切换依赖重启完成。写入目标前，Electron 会使用候选 `DSH_HOME`，在独立进程里运行源码或打包后的 `dsh --profile web --dump-config`。检查最多运行 30 秒，诊断输出也有大小限制。检查失败，当前 Host 和页面都不动。检查通过后才记录待切换目标，申请 Electron 重启，并走原有的 Host 优雅退出流程。启动器读取待切换目标后，仍保留上一次可用方案；只有新 Host 就绪且主页面加载完成，才会确认新方案可用。如果进程在这段时间退出，下次启动会识别未确认的当前方案，先写入回退状态，再启动上一次可用方案。已上报的启动失败会先等失败的 Host 进程彻底退出，再恢复并启动上一次可用方案。每个 Host supervisor 都会在等待就绪前登记。应用退出时会取消并等待正在执行的配置检查，停止回退启动，等待尚未结束的终端打开任务，再等自己持有的 Host 和 PTY 都退出后释放应用。

配置管理器是一个单独的沙箱 BrowserWindow，只加载静态 data 文档。它没有 preload、Node 集成和内联脚本。表单只会导航到固定的无实际服务 HTTPS origin，main 进程把这些被拦截的导航解析成新建、改名、选择、删除和关闭操作。删除前必须通过系统警告确认，默认按钮是“取消”。内置方案、当前方案、上一次可用方案和待切换方案都会被保护。可删除的方案目录先移入私有隔离路径，状态写入成功后，再连同整个 Harness home 一起删掉。目录被替换为软链接时会直接拒绝。主窗口可见时，管理器是它的模态子窗；用户在主窗口隐藏时从托盘打开管理器，应用会创建独立窗口。托盘显示当前方案，并提供管理入口。面向用户的文案统一叫“配置方案”，不写 Profile。

托盘还提供一个本机高级终端。沙箱 renderer 和精简 preload 负责 xterm，main 进程惰性加载 `node-pty`，校验 renderer 归属，限制输入和终端尺寸，每次只持有一个 PTY。Shell 解析覆盖 PowerShell 7、Windows PowerShell、`cmd.exe` 和 POSIX Shell。环境会删掉继承的密钥以及所有继承的 `DSH_*` 值，只再加入当前方案的 `DSH_HOME` 和桌面标记。关闭时会先尝试正常终止，超时后强制清理进程树；应用退出时仍保留同步强制停止兜底。Windows 上每次同步调用 `taskkill.exe` 最多等待 5 秒，辅助进程卡住时会强制结束它。原生 PTY 已明确从 ASAR 解包，preload 会单独构建为 CommonJS 产物。

打包后的 macOS 和 Windows 应用会在启动 60 秒后检查 `deepseeker-app/DeepSeeker` 的公开 GitHub Releases API，之后每六小时检查一次。自动检查只改托盘状态，并在单次进程里通知一次。手动检查必须确认后才下载。资产发现只接受稳定 Release，以及与系统和架构匹配的 `.dmg`、`.zip` 或 `.exe`；发布页和下载地址必须属于本仓库。

确认下载后，文件会进入 Electron 用户数据目录下的私有版本目录。Release 检查的总时限是 15 秒。安装包下载只在等待响应或下一块数据时启用 30 秒无进展计时，所以持续有数据的大文件不受固定总时限影响。下载器还会限制 API 响应和安装包大小，限制资产名称，要求最终跳转仍是 GitHub 的 HTTPS 主机，流式写盘而不把安装包整个放进内存，并持续上报进度。已完成的安装包只有重新通过同样的检查才会复用；旧文件无效时，也会保留到新文件完成检查再替换。超时会取消请求并删掉临时文件。只有文件大小与 Release 完全一致、GitHub SHA-256 一致、容器文件头通过，临时文件才会原子发布。没有 GitHub 摘要的产物仍可以从 Release 页访问，但应用不会提供内置下载。macOS 打开校验后的 DMG 或 ZIP，不退出当前应用。Windows 会再问一次，然后不经过 shell 启动校验后的安装器；只有子进程触发 `spawn` 后才退出。任何失败都保留当前应用。

桌面包版本为 `0.2.0`。Host 暂存使用 pnpm legacy deploy，它会临时改写源码工作区的依赖布局；暂存脚本会在成功或失败后使用冻结锁文件重新连接工作区，打完包后源码 CLI 仍可直接运行。macOS 打包命令会在调用 Electron Builder 前删掉固定文件名的旧压缩包和校验文件，把继承的不完整 linker 签名替换为一套递归 ad-hoc 签名，只有整个包通过严格深度验签后才继续，再用流式读取生成新的 `DeepSeeker-mac-arm64.zip.sha256`，不会把整个压缩包读入内存。这能确认应用包结构完整，但不包含 Developer ID，也没有经过 Apple 公证。after-pack 检查要求 Host 入口、main 进程、终端 preload、xterm CSS、原生 PTY 二进制和 macOS spawn helper 全部存在。Windows Electron Builder 生成 x64 单用户 NSIS 安装器，固定名为 `DeepSeeker-windows-x64-setup.exe`。Windows workflow 由 tag 驱动，要求 tag 必须等于 `v<桌面版本>`，在 `windows-latest` 上构建，检查 PE 文件头，静默安装到临时目录，用 Node 模式启动安装后的 Electron 运行时，检查 Host 与原生 PTY 文件，再静默卸载，生成 SHA-256 sidecar，最后使用仓库的 `contents: write` 权限把两个 Windows 文件上传到 GitHub Release 草稿。macOS 压缩包和两个平台的校验文件全部到齐后，草稿才会公开。Pages workflow 还会检查公开的 latest Release 是否与桌面版本一致、四个文件是否齐全，并且每个下载的 sidecar 都写了对应文件名，内容与 GitHub SHA-256 摘要相同；任一条件不满足都不会部署。

## 验证

桌面测试覆盖方案名称校验、私有隔离存储、新建、改名、受保护的删除、私有 home 删除、软链接拒绝、待切换状态、上一次可用状态确认、已上报失败回退、启动中断后的下次启动恢复、退出取消、损坏状态恢复，以及被拒绝新方案的清理。管理窗口测试固定了 HTML 转义、无脚本 CSP、唯一动作 origin 和删除命令。Host 测试覆盖成功、失败、超时和应用取消的 profile 探针，并确认子进程退出会被等待。终端测试覆盖 Shell 选择、环境过滤、路径校验、有界输入与尺寸、Windows 辅助进程超时、进程树终止、renderer/preload 接线和无脚本 CSP。更新测试覆盖 SemVer 比较、macOS 与 Windows 资产选择、无更新与检查失败的区分、挂起的版本检查与下载超时、已验证安装包的复用与替换、下载进度、精确大小与摘要校验、ZIP 文件头校验、不可信跳转拒绝，以及临时文件清理。集成源码检查固定了先验证后写入、提前登记 Host、回退前清理失败 Host、页面加载后再确认可用、主窗口隐藏时独立显示管理器、删除前确认、下载前确认、Windows 执行前再次确认、`DSH_HOME` 隔离、待打开终端的清理和窗口沙箱。打包测试固定了 `0.2.0` 版本、NSIS 配置、原生 PTY 解包、终端打包资源、macOS 压缩前的 ad-hoc 签名与严格验签、构建前删除固定文件名的陈旧 macOS 产物、macOS sidecar 自动生成、Windows 静默安装／运行时／卸载冒烟、Windows Release 草稿，以及 Pages 对 Release 文件和校验内容的对账。发布验收会解开最终 ZIP，再次检查严格签名、版本、运行时入口、压缩包完整性和 SHA-256。

## 考虑过的替代方案

**在同一个 Harness home 下直接使用上游 profile。** 这种 profile 能隔离组合 patch 与插件，但基础设置和密钥仍在 Harness-home 层共享。独立 home 才符合用户对工作和个人方案不共享密钥、模型与会话的理解。

**先停当前 Host，再原地试跑候选配置。** 坏 profile 会把本来可撤销的选择变成一次停机。独立 dump-config 探针会在碰健康进程前检查组合；完整启动时才出现的问题则交给启动回退处理。

**直接使用 Electron autoUpdater，或下载未校验的浏览器地址。** 通用 autoUpdater 依赖特定更新源与平台产物约定。直接发现 GitHub Release，可以继续把 Releases 当成唯一存储；同时保留 URL、大小、摘要和文件格式校验，安装交接也更清楚。

**用系统快捷方式打开外部终端。** 这条路很难稳定管理输入、输出、尺寸、进程归属、当前方案环境和应用退出。应用自己持有 PTY，边界可以测试，清理逻辑也更明确。

## 后果

用户可以新建、改名、切换和删除名称清楚、数据真正隔离的工作环境，不需要手改文件。预检查失败不会碰健康 Host，上一次可用状态也能兜住启动期失败。高级用户可以打开一个绑定当前方案的本机终端，renderer 没有直接进程权限。GitHub Releases 同时负责版本发现和安装包存储，Windows 稳定文件名还能让官网长期使用不带版本号的 `/releases/latest/download/` 链接。

切换配置会明确重启一次桌面应用。删除方案会在确认后永久删掉它的私有设置、密钥、插件和会话。自动检查需要访问 `api.github.com`，下载需要访问 GitHub Release 主机。macOS ZIP 只有 ad-hoc 签名，没有 Developer ID 和 Apple 公证；用户核对摘要后，下载的 App 仍可能需要按住 Control 选择“打开”或移除 quarantine。Windows 安装器还没有 Authenticode 签名；没做签名前，workflow 不需要额外 secret。Linux 仍没有安装器和自动更新交接。桌面终端只处理本机单会话，Windows ConPTY 还需要在 Windows 上完成最终交互验收。
