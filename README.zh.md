# DeepSeeker

中文 | [English](README.md)

**The DeepSeek Agent anyone can use.**

DeepSeeker 把官方 DeepSeek Harness 装进一个桌面 App。下载、打开、粘贴 API Key，就能干活。

不用装 Node.js。不用开终端。也不用管 localhost 和端口。

## 第一版

- macOS Apple Silicon 桌面应用
- 首次启动引导填写 DeepSeek API Key
- 自动启动和管理本地 Harness 服务
- 关闭窗口后可在系统托盘继续运行
- 工作区、会话、插件和 Harness 原有能力全部保留
- 用户数据和 Harness 服务留在本机

Windows 安装包会在 macOS 版本跑稳后补上。

<a id="run"></a>
<a id="run-from-source"></a>

## 本地启动

```sh
pnpm install
pnpm run dev:desktop
```

生成当前平台的未签名 ZIP：

```sh
pnpm run package:desktop
```

## 项目来源

DeepSeeker 基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 和社区项目 [deepseek-harness-desktop](https://github.com/anywhere-labs/deepseek-harness-desktop) 继续开发。

Harness 核心、插件系统和 Web UI 来自 DeepSeek 官方项目。DeepSeeker 负责桌面封装、安装体验、品牌和后续面向普通用户的产品功能。

本项目遵循 [MIT License](LICENSE)，并保留原项目版权与归属信息。

> DeepSeeker 是社区产品，与 DeepSeek 官方无隶属或背书关系。
