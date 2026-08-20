# DeepSeeker

[中文](README.zh.md) | English

**The DeepSeek Agent anyone can use.**

DeepSeeker puts the official DeepSeek Harness inside a desktop app. Download it, open it, paste your API key, and start working.

No Node.js setup. No terminal. No localhost or port management.

## What You Get

- Apple Silicon macOS app and Windows x64 installer
- First-run DeepSeek API key setup
- Automatic local Harness startup and supervision
- Separate configuration schemes for different models, credentials, plugins, and sessions
- A local desktop terminal for users who need direct shell access
- Opt-in phone control through a paired Cloudflare tunnel
- Packaged apps check GitHub Releases after startup and every six hours; downloads require confirmation and SHA-256 verification
- System tray controls after the main window closes
- Existing Harness workspaces, sessions, plugins, and agent features
- Local application data and Harness service

## Download

- [macOS Apple Silicon](https://github.com/deepseeker-app/DeepSeeker/releases/latest/download/DeepSeeker-mac-arm64.zip)
- [Windows x64](https://github.com/deepseeker-app/DeepSeeker/releases/latest/download/DeepSeeker-windows-x64-setup.exe)
- [Checksums and release notes](https://github.com/deepseeker-app/DeepSeeker/releases/latest)

The macOS ZIP is ad-hoc signed but not Apple-notarized yet. Verify its SHA-256 first, move DeepSeeker to Applications, then Control-click the app and choose **Open**. If macOS still blocks that verified copy:

```sh
xattr -dr com.apple.quarantine /Applications/DeepSeeker.app
```

The Windows installer is not Authenticode-signed yet. Verify its SHA-256 first. If Microsoft Defender SmartScreen appears, choose **More info**, check the filename, then choose **Run anyway**.

<a id="run"></a><a id="run-from-source"></a>

## Run Locally

```sh
pnpm install
pnpm run dev:desktop
```

Build an ad-hoc-signed ZIP on macOS, or an unpacked app directory on other platforms:

```sh
pnpm run package:desktop
```

Build the Windows x64 NSIS installer on Windows:

```sh
pnpm run dist:win:desktop
```

## Upstream

DeepSeeker builds on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) and the community [deepseek-harness-desktop](https://github.com/anywhere-labs/deepseek-harness-desktop) project.

DeepSeek provides the Harness core, plugin system, and Web UI. DeepSeeker owns the desktop packaging, installation experience, brand, and consumer-facing product work.

This project is licensed under the [MIT License](LICENSE) and retains the original copyright and attribution notices.

> DeepSeeker is an independent community product. It is not affiliated with or endorsed by DeepSeek.
