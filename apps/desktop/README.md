# DeepSeeker Desktop

English | [中文](README.zh.md)

The desktop app supervises the existing loopback Web Host and keeps it alive from the system tray when its window is closed.

## Development

Install dependencies, then use the single desktop development command. It builds the Host and client packages, Web frontend, and Electron main process before launching the application:

```sh
pnpm run dev:desktop
```

Closing the window hides it. Use the tray menu to restore the window or quit the application. Explicit quit waits for the Host process to stop and escalates termination after the bounded Host grace period.

The desktop app accepts only the readiness URL emitted by `dsh web` for `127.0.0.1` or `localhost`. Navigation stays on that origin; HTTP and HTTPS links open in the system browser.

Native chrome follows the host platform. macOS uses a frameless inset title bar, traffic lights, and sidebar vibrancy; its collapsed sidebar is 90px wide, with centered controls whose top edge aligns with the expanded logo row below the traffic lights. Windows retains its system frame, shadow, resize and Snap behavior, and Windows 11 rounded corners while a hidden title bar places the native caption buttons in the Session header's first row; the Windows sidebar has no traffic-light inset. The empty part of that row remains draggable, its controls remain clickable, and a resident drag band covers the same row when no Session header is visible. Windows acrylic and macOS vibrancy reach only the sidebar, while conversation and details stay opaque. Linux keeps a frameless window and an opaque sidebar fallback.

## Configuration schemes

The tray menu exposes **Configuration schemes** and a small sandboxed manager window. The built-in Default scheme reuses the ordinary `$DSH_HOME` (or `~/.dsh`). Every scheme created in the manager owns a separate Harness home under Electron's private user-data directory, so its model settings, credentials, plugins, sessions, and profile patches do not leak into another scheme. Names are user-controlled and can be changed later. An inactive user-created scheme can also be deleted after a native confirmation; deletion removes its entire private Harness home. The built-in Default and the running scheme cannot be deleted.

Selection does not stop the running Host immediately. DeepSeeker first launches `dsh --profile web --dump-config` in a separate bounded process against the candidate Harness home. A failed or timed-out check leaves the current Host and window untouched. A successful check writes a pending selection atomically and restarts Electron through the ordinary graceful Host shutdown. Startup promotes the scheme to last-known-good only after the loopback Host reaches readiness and the renderer loads. If a checked scheme still fails during real startup, the launcher restores the previous known-good scheme.

## Desktop terminal

The tray's **Advanced features > Desktop terminal** command opens one local terminal session for users who need direct shell access. It uses a sandboxed renderer, an isolated preload, xterm, and a lazily loaded `node-pty`; a missing or broken PTY module therefore cannot stop the main product from starting. The shell begins at the packaged Host working directory and receives the active scheme's `DSH_HOME`, but inherited credentials and unrelated `DSH_*` variables are removed.

DeepSeeker resolves PowerShell 7, Windows PowerShell, or `cmd.exe` on Windows and a valid POSIX shell on macOS and Linux. Input and terminal dimensions are bounded in the main process. Closing the terminal asks the shell to exit, escalates after a timeout, and terminates the complete process tree on Windows. Application shutdown joins the terminal cleanup and keeps a final force-stop fallback.

## Updates

Packaged macOS and Windows builds check the public DeepSeeker GitHub Release feed after 60 seconds and every six hours. Each check has a 15-second deadline. Automatic checks only update the tray and show one native notification; they never start a download. The tray's **Check for Updates** command shows the result and asks before downloading anything.

The downloader accepts only assets from this repository's GitHub Release URLs, follows redirects only to GitHub-owned hosts, limits artifacts to 1 GiB, and cancels when the response or next body chunk makes no progress for 30 seconds. It writes into a private user-data directory and publishes the file only after its declared size, required GitHub SHA-256, and DMG, ZIP, or PE container signature pass. Timeouts remove the partial file. Assets without a GitHub digest remain available through the Release page but are not downloaded by the app. The tray reports integer download progress. macOS opens the verified DMG or ZIP and leaves the running app intact. Windows asks a second time before launching the verified NSIS installer and quitting. A request, validation, open, or installer-launch failure leaves the current app running.

## Packaging

The local packaging command performs the complete repository build and stages the Host's closed production dependency tree. Staging uses pnpm's legacy deploy, which temporarily rewrites the workspace dependency layout, so the script relinks the source workspace from the frozen lockfile before returning on both success and failure. On macOS it assembles the app under system temporary storage, applies and verifies an ad-hoc signature, then writes the ZIP and its streamed `.sha256` sidecar to `apps/desktop/dist`; this prevents AppleDouble files from an external volume from corrupting Electron packaging. The ad-hoc signature proves bundle integrity but does not provide a Developer ID or Apple notarization. A separate manual build is not required:

```sh
pnpm run package:desktop
```

The app inside the ZIP runs the staged `@deepseek-ai/dsh` CLI in a separate process through Electron's Node mode. It therefore retains the supervised-Host lifecycle without shipping a second Node executable. An `afterPack` check rejects the package before compression when the staged CLI entry or Web frontend entry is absent. Both macOS and Windows use the exact tracked `apps/desktop/build/icon.png` source; the repository does not preprocess or commit platform-specific icon variants.

### Windows NSIS installer

Build the x64 per-user NSIS installer on Windows:

```sh
pnpm run dist:win:desktop
```

The stable artifact name is `apps/desktop/dist/DeepSeeker-windows-x64-setup.exe`, which keeps `/releases/latest/download/DeepSeeker-windows-x64-setup.exe` valid across releases. `.github/workflows/release-windows.yml` runs on a `v*` tag or a manually supplied tag, rejects a tag that differs from `apps/desktop/package.json`, builds on `windows-latest`, checks the PE header, writes a SHA-256 file, and attaches both Windows files to a draft GitHub Release. Publish the draft only after the macOS ZIP and sidecar bring the Release to four assets. The Pages workflow also refuses deployment unless both sidecars name the expected artifact and match GitHub's digest. The workflows use the repository-provided `GITHUB_TOKEN`; no additional secret is needed while the installer remains unsigned.

### Signed macOS DMG

The macOS distribution command requires a valid `Developer ID Application` identity whose certificate and private key are both installed in the build user's Keychain. It also requires one complete notarization credential source. A Keychain profile keeps the app-specific password out of the repository and shell history:

```sh
xcrun notarytool store-credentials "dsh-notary" --apple-id "<Apple ID>" --team-id "<Team ID>"
```

`notarytool` requests the secret interactively. Build the signed, hardened-runtime, notarized DMG with the stored profile:

```sh
APPLE_KEYCHAIN_PROFILE=dsh-notary pnpm run dist:mac:desktop
```

An existing secrets file can supply `MAC_CERT_P12_BASE64`, `MACOS_SIGN_IDENTITY`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` without importing the certificate into the persistent Keychain:

```sh
node --env-file=/absolute/path/to/macos-signing-secrets.env --import tsx apps/desktop/scripts/release-mac.ts
```

Electron Builder imports that Base64 PKCS#12 certificate into its temporary Keychain and removes it when the build finishes. The wrapper keeps signing and notarization variables out of the repository-build and runtime-staging subprocesses, then passes them only to Electron Builder. The secrets file and its path are never tracked.

The release preflight runs before the repository build. It fails if the host is not macOS, the supplied identity is not a `Developer ID Application` identity, signing credentials are incomplete, signing discovery is disabled, or notarization credentials are missing or incomplete. Without the PKCS#12 group, it requires a usable `Developer ID Application` identity and private key in the Keychain. Instead of a Keychain profile, the command accepts the complete Apple ID group (`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID`) or App Store Connect API key group (`APPLE_API_KEY`, `APPLE_API_KEY_ID`, and `APPLE_API_ISSUER`).

After a successful build, mount the generated DMG and verify the installed application signature, Gatekeeper assessment, and stapled notarization ticket:

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

## Known limitations

The first desktop assembly uses a loopback HTTP Host. The renderer and Host protocol remain unchanged so the application can replace the transport with the IPC carrier reserved by the GUI architecture without changing product features.

Windows has a real x64 NSIS installer and Release workflow, but Authenticode signing is still pending. Linux packaging still creates an unpacked application. The desktop terminal intentionally supports one local PTY at a time; remote shells and saved terminal profiles remain outside this desktop shell. Its Windows ConPTY path still needs a real Windows runner or machine for final interactive acceptance.

## Model Experience

The desktop shell does not add model-visible input. The reused Web profile continues to own its existing Web runtime context.
