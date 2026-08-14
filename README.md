# DeepSeeker

[中文](README.zh.md) | English

**The DeepSeek Agent anyone can use.**

DeepSeeker puts the official DeepSeek Harness inside a desktop app. Download it, open it, paste your API key, and start working.

No Node.js setup. No terminal. No localhost or port management.

## First Release

- Native desktop app for Apple Silicon Macs
- First-run DeepSeek API key setup
- Automatic local Harness startup and supervision
- System tray support after the main window closes
- Existing Harness workspaces, sessions, plugins, and agent features
- Local application data and Harness service

A Windows installer will follow after the macOS release is stable.

<a id="run"></a>
<a id="run-from-source"></a>

## Run Locally

```sh
pnpm install
pnpm run dev:desktop
```

Build an unsigned ZIP for the current platform:

```sh
pnpm run package:desktop
```

## Upstream

DeepSeeker builds on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) and the community [deepseek-harness-desktop](https://github.com/anywhere-labs/deepseek-harness-desktop) project.

DeepSeek provides the Harness core, plugin system, and Web UI. DeepSeeker owns the desktop packaging, installation experience, brand, and consumer-facing product work.

This project is licensed under the [MIT License](LICENSE) and retains the original copyright and attribution notices.

> DeepSeeker is an independent community product. It is not affiliated with or endorsed by DeepSeek.
