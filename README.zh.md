# DeepSeeker

中文 | [English](README.md)

**The DeepSeek Agent anyone can use.**

DeepSeeker 把官方 DeepSeek Harness 装进一个桌面 App。下载、打开、粘贴 API Key，就能干活。

不用装 Node.js。不用开终端。也不用管 localhost 和端口。

## 现在能用的

- macOS Apple Silicon 应用和 Windows x64 安装包
- 首次启动引导填写 DeepSeek API Key
- 自动启动和管理本地 Harness 服务
- 不同模型、密钥、插件和会话可以放进独立配置方案
- 给需要直接操作 Shell 的用户准备了本机桌面终端
- 手机扫码配对后，可通过 Cloudflare 临时隧道远程控制
- 打包版启动后会检查 GitHub Release，之后每 6 小时复查；下载需用户确认，并强制校验 SHA-256
- 关闭窗口后可在系统托盘继续运行和管理
- 工作区、会话、插件和 Harness 原有能力全部保留
- 用户数据和 Harness 服务留在本机

## 下载

- [macOS Apple Silicon](https://github.com/deepseeker-app/DeepSeeker/releases/latest/download/DeepSeeker-mac-arm64.zip)
- [Windows x64](https://github.com/deepseeker-app/DeepSeeker/releases/latest/download/DeepSeeker-windows-x64-setup.exe)
- [校验文件和更新说明](https://github.com/deepseeker-app/DeepSeeker/releases/latest)

macOS ZIP 已做 ad-hoc 签名，还没有经过 Apple 公证。先核对 SHA-256，把 DeepSeeker 放进“应用程序”，再按住 Control 点它并选择“打开”。如果系统仍拦截这份已经校验过的 App：

```sh
xattr -dr com.apple.quarantine /Applications/DeepSeeker.app
```

Windows 安装器还没有 Authenticode 签名。先核对 SHA-256。如果 Microsoft Defender SmartScreen 弹出，选择“更多信息”，确认文件名后再点“仍要运行”。

<a id="run"></a><a id="run-from-source"></a>

## 本地启动

```sh
pnpm install
pnpm run dev:desktop
```

在 macOS 生成 ad-hoc 签名 ZIP；其他平台生成未打包的应用目录：

```sh
pnpm run package:desktop
```

在 Windows 上生成 x64 NSIS 安装包：

```sh
pnpm run dist:win:desktop
```

## 项目来源

DeepSeeker 基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 和社区项目 [deepseek-harness-desktop](https://github.com/anywhere-labs/deepseek-harness-desktop) 继续开发。

Harness 核心、插件系统和 Web UI 来自 DeepSeek 官方项目。DeepSeeker 负责桌面封装、安装体验、品牌和后续面向普通用户的产品功能。

本项目遵循 [MIT License](LICENSE)，并保留原项目版权与归属信息。

> DeepSeeker 是社区产品，与 DeepSeek 官方无隶属或背书关系。
