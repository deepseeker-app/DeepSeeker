import { useEffect, useRef, useState } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import {
  AppleLogo,
  ArrowDown,
  ArrowRight,
  ChatsCircle,
  Check,
  Code,
  Copy,
  Desktop,
  DownloadSimple,
  FileText,
  GithubLogo,
  Key,
  List,
  Question,
  WindowsLogo,
  X,
} from "@phosphor-icons/react";
import { AuroraCanvas } from "./AuroraCanvas.jsx";

gsap.registerPlugin(useGSAP, ScrollTrigger);

const GITHUB_URL = "https://github.com/deepseeker-app/DeepSeeker";
const HARNESS_URL = "https://www.deepseek.com/harness/";
const MAC_DOWNLOAD_URL = `${GITHUB_URL}/releases/latest/download/DeepSeeker-mac-arm64.zip`;
const WINDOWS_DOWNLOAD_URL = `${GITHUB_URL}/releases/latest/download/DeepSeeker-windows-x64-setup.exe`;
const assetUrl = (path) => `${import.meta.env.BASE_URL}${path}`;
const SKINS_URL = `${import.meta.env.BASE_URL}skins/`;

const COPY = {
  zh: {
    nav: ["产品", "Harness", "实机", "皮肤", "下载", "开源", "FAQ"],
    heroLabel: "DeepSeek Harness 桌面端",
    headline: "DeepSeeker",
    principle: "一切皆插件",
    heroBody: "把 DeepSeek Harness 装进电脑。模型、工具、技能、会话、沙箱、存储、循环、调度和 UI，都可以自由替换和组合。",
    github: "查看 GitHub",
    learnMore: "继续了解",
    directDownload: "直接下载",
    sourceInstall: "源码安装",
    mac: "macOS · Apple Silicon",
    win: "Windows · x64",
    copy: "复制",
    copied: "已复制",
    heroNote: "下载，填入 DeepSeek API Key，马上开始。",
    whyLabel: "Agent = Model + Harness",
    whyTitle: "Harness 让 Agent 在真实场景中持续工作",
    whyBody: "模型是 Agent 的灵魂。Harness 让它理解环境、调用工具，还能把一件真实任务持续做下去。",
    pillars: [
      ["Cordis 内核", "CORDIS KERNEL", "内核负责插件的加载、卸载和依赖关系，具体能力交给插件。"],
      ["插件提供能力", "CAPABILITIES AS PLUGINS", "模型、工具、技能、会话、沙箱、存储、循环、调度和 UI，都由插件提供。"],
      ["配置层自由组合", "COMPOSE IN CONFIGURATION", "不用改 Harness 源码，在配置里就能选择、替换或扩展任一能力。"],
    ],
    productLabel: "DeepSeeker 桌面端",
    productTitle: "本地桌面 AI 智能体，专注真实工作",
    productBody: "文件、终端和会话都在一个桌面工作区里。选个文件夹，直接说你要做什么。",
    productFeatures: [
      ["本地桌面访问", "文件、终端和工作内容留在你的电脑里。"],
      ["对话工作区", "不同任务分开聊，历史记录随时接着做。"],
      ["文件与上下文", "它能读项目文件，也能跟住你正在做的事。"],
      ["开源与社区", "跟随 DeepSeek Harness 更新，代码公开，谁都能检查。"],
    ],
    productProof: ["本机运行", "文件上下文", "Session log", "MIT 开源"],
    productAlt: "DeepSeeker 桌面端实机工作界面",
    featureLabel: "设计思路",
    featureTitle: "一切皆插件，运行有迹可循",
    features: [
      ["一切皆插件", "DeepSeek Harness 基于 Cordis 插件系统。Agent 的能力由插件提供，再通过服务和事件彼此配合。你可以按任务换模型、工具、存储和运行方式。"],
      ["每一次运行都有迹可循", "模型看到的内容会写进只追加的会话日志。系统提示词、工具调用、子 Agent 调度和上下文注入，都能在轨迹视图里查到。"],
      ["多种运行模式", "标准、PTC、极简和创造模式各有一套工具组合。DeepSeeker 也能根据任务切换预设，桌面端直接选。"],
    ],
    featureUi: {
      plugins: {
        title: "工作区插件",
        status: "9 个运行中",
        items: [
          ["MODEL", "DeepSeek V4", "已就绪"],
          ["TOOLS", "文件与终端", "6 个工具"],
          ["MEMORY", "Session log", "本地"],
          ["LOOP", "Agent loop", "运行中"],
          ["SKILLS", "任务技能", "12 个可用"],
          ["UI", "DeepSeeker", "已连接"],
        ],
      },
      trace: {
        title: "任务轨迹",
        session: "Session DS-042",
        steps: [
          ["理解任务", "读取工作区和 AGENTS.md", "完成"],
          ["调用工具", "检索 18 个文件", "完成"],
          ["执行修改", "更新桌面端配置", "进行中"],
          ["验证结果", "等待回归测试", "等待"],
        ],
      },
      profiles: {
        title: "Profile 与运行模式",
        profiles: ["默认", "编程", "极简", "创造"],
        selected: "编程",
        modeLabel: "运行模式",
        mode: "Code Agent",
        rows: [["模型", "DeepSeek V4"], ["权限", "工作区"], ["工具", "终端、文件、Git"]],
      },
    },
    demoTitle: "这就是 DeepSeeker 桌面端",
    demoBody: "这是当前版本的真实界面。选工作区、切运行模式、发任务，都在一个窗口里完成。",
    previewNote: "当前桌面版实机画面",
    installLabel: "开始使用",
    installTitle: "下载安装到电脑，马上开始",
    steps: [
      ["下载并安装", "下载对应系统的安装包，按提示完成安装。"],
      ["填入 API Key", "首次打开时填入 DeepSeek API Key，只保存在本机。"],
      ["选个文件夹开工", "把项目交给 DeepSeeker，直接说你要做什么。"],
    ],
    sourceTitle: "想自己改？源码也在 GitHub",
    sourceBody: "DeepSeeker 和上游 DeepSeek Harness 的项目源码都按 MIT License 开放。第三方依赖保留各自许可。代码能看，也能改。",
    openLabel: "Open source",
    openTitle: "开源、透明、可自由使用",
    openBody: "DeepSeeker 基于 DeepSeek Harness，项目源码按 MIT License 开放。第三方依赖保留各自许可。你可以自己查看、修改，也可以跟着项目一起更新。",
    openSource: "在 GitHub 查看源码",
    openChecks: ["可以自由使用", "可以修改分发", "可以检查代码", "不用绑定账号"],
    faqTitle: "常见问题",
    faqs: [
      ["DeepSeeker 需要另外安装 Node.js 吗？", "不用。桌面版会带上需要的运行环境。"],
      ["DeepSeek API Key 去哪里拿？", "在 DeepSeek 开放平台创建。第一次打开 DeepSeeker 时会引导你填入。"],
      ["文件和会话会离开电脑吗？", "工作区、文件读取和会话保存在本机。调用模型时，只发送当前任务需要的上下文。"],
      ["它和 DeepSeek Harness 是什么关系？", "DeepSeeker 是基于 DeepSeek Harness 做的桌面端。核心能力跟随上游，安装和日常使用更省事。"],
      ["现在支持 Windows 吗？", "支持。下载页提供 Windows x64 安装包，macOS 目前提供 Apple Silicon 版本。"],
      ["macOS 提示无法验证开发者怎么办？", "当前 ZIP 还没做 Apple 公证。核对 SHA-256 后，把 App 放进“应用程序”，按住 Control 点图标，再选“打开”。"],
      ["Windows 被 SmartScreen 拦住怎么办？", "当前安装器还没做 Authenticode 签名。先核对 SHA-256，再点“更多信息”，确认文件名后选择“仍要运行”。"],
      ["怎么参与开发？", "去 GitHub 提 Issue 或 PR。"],
    ],
    ctaTitle: "把 DeepSeek Harness 装进电脑",
    ctaBody: "少配环境，直接开工。",
    attribution: "了解 DeepSeek Harness",
    footer: "基于 DeepSeek Harness 构建",
    rights: "© 2026 DeepSeeker · MIT License",
  },
  en: {
    nav: ["Product", "Harness", "Preview", "Skins", "Download", "Open source", "FAQ"],
    heroLabel: "DeepSeek Harness for desktop",
    headline: "DeepSeeker",
    principle: "Everything is a plugin",
    heroBody: "Put DeepSeek Harness on your desktop. Models, tools, skills, sessions, sandboxes, storage, loops, scheduling, and the UI can all be swapped and recomposed.",
    github: "View on GitHub",
    learnMore: "Learn more",
    directDownload: "Direct download",
    sourceInstall: "Install from source",
    mac: "macOS · Apple Silicon",
    win: "Windows · x64",
    copy: "Copy",
    copied: "Copied",
    heroNote: "Download. Add your DeepSeek API key. Start working.",
    whyLabel: "Agent = Model + Harness",
    whyTitle: "A harness keeps agents working in real-world environments",
    whyBody: "The model is the soul of an agent. A harness lets it understand the environment, use tools, and keep a real task moving.",
    pillars: [
      ["Cordis kernel", "CORDIS KERNEL", "The kernel manages plugin mounting, unmounting, and dependencies. Agent capabilities live in plugins."],
      ["Capabilities as plugins", "CAPABILITIES AS PLUGINS", "Plugins provide models, tools, skills, sessions, sandboxes, storage, loops, scheduling, and the UI."],
      ["Compose with configuration", "COMPOSE IN CONFIGURATION", "Select, swap, or extend capabilities in configuration without changing the Harness source."],
    ],
    productLabel: "DeepSeeker desktop",
    productTitle: "A local desktop agent built for real work",
    productBody: "Files, terminals, and conversations live in one desktop workspace. Choose a folder and tell DeepSeeker what needs doing.",
    productFeatures: [
      ["Local desktop access", "Files, terminals, and active work stay on your computer."],
      ["Conversation workspaces", "Keep tasks separate and pick up where you left off."],
      ["Files and context", "It reads project files and follows the work in front of you."],
      ["Open source", "Track DeepSeek Harness releases and inspect every line of code."],
    ],
    productProof: ["Runs locally", "File context", "Session log", "MIT licensed"],
    productAlt: "DeepSeeker desktop application working on a real task",
    featureLabel: "Design approach",
    featureTitle: "Everything is a plugin. Every run is traceable.",
    features: [
      ["Everything is a plugin", "DeepSeek Harness runs on the Cordis plugin system. Agent capabilities work together through services and events, so models, tools, storage, and runtime modes can change with the task."],
      ["Every run is traceable", "Everything the model sees is written to an append-only session log. System prompts, tool calls, subagent scheduling, and context injections remain inspectable in the Trajectory view."],
      ["Multiple runtime modes", "Standard, Code, Minimal, and Creator modes each carry a different toolset. DeepSeeker lets you choose the right preset from the desktop app."],
    ],
    featureUi: {
      plugins: {
        title: "Workspace plugins",
        status: "9 active",
        items: [
          ["MODEL", "DeepSeek V4", "Ready"],
          ["TOOLS", "Files & terminal", "6 tools"],
          ["MEMORY", "Session log", "Local"],
          ["LOOP", "Agent loop", "Running"],
          ["SKILLS", "Task skills", "12 available"],
          ["UI", "DeepSeeker", "Connected"],
        ],
      },
      trace: {
        title: "Task trajectory",
        session: "Session DS-042",
        steps: [
          ["Understand task", "Read workspace and AGENTS.md", "Done"],
          ["Call tools", "Inspect 18 files", "Done"],
          ["Apply changes", "Update desktop configuration", "Running"],
          ["Verify result", "Regression checks queued", "Queued"],
        ],
      },
      profiles: {
        title: "Profiles and runtime modes",
        profiles: ["Default", "Code", "Minimal", "Creator"],
        selected: "Code",
        modeLabel: "Runtime mode",
        mode: "Code Agent",
        rows: [["Model", "DeepSeek V4"], ["Permission", "Workspace"], ["Tools", "Terminal, files, Git"]],
      },
    },
    demoTitle: "This is the DeepSeeker desktop app",
    demoBody: "This is the current desktop build. Choose a workspace, switch runtime modes, and send a task from one window.",
    previewNote: "Current desktop app capture",
    installLabel: "Get started",
    installTitle: "Install it. Add a key. Start working.",
    steps: [
      ["Download and install", "Get the package for your system and follow the install steps."],
      ["Add an API key", "Paste your DeepSeek API key on first launch. It stays on this device."],
      ["Choose a folder", "Give DeepSeeker a project and tell it what needs doing."],
    ],
    sourceTitle: "Want to change it? The source is on GitHub.",
    sourceBody: "DeepSeeker and upstream DeepSeek Harness release their project source under the MIT License. Third-party dependencies keep their own terms. Read the code and make it yours.",
    openLabel: "Open source",
    openTitle: "Open, inspectable, and yours to use",
    openBody: "DeepSeeker is built on DeepSeek Harness. Its project source is released under the MIT License, while third-party dependencies keep their own terms. Read it, change it, and keep it current with the upstream project.",
    openSource: "View source on GitHub",
    openChecks: ["Free to use", "Modify and distribute", "Inspect the code", "No account lock-in"],
    faqTitle: "Questions",
    faqs: [
      ["Do I need to install Node.js?", "No. The desktop build ships with the runtime it needs."],
      ["Where do I get a DeepSeek API key?", "Create one on the DeepSeek Platform. DeepSeeker guides you through setup on first launch."],
      ["Do files and sessions leave my computer?", "Workspaces, file access, and sessions stay local. Only context needed for the current model call is sent."],
      ["How is this related to DeepSeek Harness?", "DeepSeeker is a desktop distribution built on DeepSeek Harness. It follows the upstream core and removes setup friction."],
      ["Is Windows supported?", "Yes. The download page includes a Windows x64 installer and an Apple Silicon macOS build."],
      ["What if macOS cannot verify the developer?", "The ZIP is not Apple-notarized yet. After checking its SHA-256, move the app to Applications, Control-click it, and choose Open."],
      ["What if Windows SmartScreen blocks the installer?", "The installer is not Authenticode-signed yet. Verify its SHA-256, choose More info, check the filename, then choose Run anyway."],
      ["How can I contribute?", "Open an Issue or send a PR on GitHub."],
    ],
    ctaTitle: "Put DeepSeek Harness on your desktop",
    ctaBody: "Less setup. Start working.",
    attribution: "Learn about DeepSeek Harness",
    footer: "Built on DeepSeek Harness",
    rights: "© 2026 DeepSeeker · MIT License",
  },
};

const PILLAR_ICONS = [Code, Desktop, FileText];
const PRODUCT_ICONS = [Desktop, ChatsCircle, FileText, Code];
const STEP_ICONS = [DownloadSimple, Key, Desktop];
const FEATURE_TYPES = ["plugins", "trace", "profiles"];
const SOURCE_COMMAND = "git clone https://github.com/deepseeker-app/DeepSeeker.git";

function Brand({ compact = false }) {
  return (
    <a className="brand" href="#top" aria-label="DeepSeeker home">
      <img src={assetUrl("whale.svg")} alt="" />
      <span className={compact ? "brand-name compact" : "brand-name"}>DeepSeeker</span>
      {!compact && <span className="brand-tag">Desktop</span>}
    </a>
  );
}

function Nav({ lang, setLang, copy }) {
  const [open, setOpen] = useState(false);
  const links = ["#product", "#why", "#demo", SKINS_URL, "#download", "#open-source", "#faq"];

  return (
    <header className="site-nav">
      <div className="nav-inner">
        <Brand />
        <nav className={open ? "nav-links open" : "nav-links"} aria-label="Primary navigation">
          {copy.nav.map((item, index) => (
            <a key={item} href={links[index]} onClick={() => setOpen(false)}>{item}</a>
          ))}
        </nav>
        <div className="nav-actions">
          <div className="language-switch" aria-label="Language">
            <button className={lang === "zh" ? "active" : ""} onClick={() => setLang("zh")}>中文</button>
            <button className={lang === "en" ? "active" : ""} onClick={() => setLang("en")}>EN</button>
          </div>
          <button className="menu-button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-label="Toggle navigation">
            {open ? <X /> : <List />}
          </button>
        </div>
      </div>
    </header>
  );
}

function ProductWindow({ copy, className = "" }) {
  return (
    <div className={`product-window ${className}`}>
      <img src={assetUrl("deepseeker-app.png?v=20260816-light-restored")} alt={copy.productAlt} />
    </div>
  );
}

function DownloadButtons({ copy, compact = false }) {
  const [platform, setPlatform] = useState("mac");

  return (
    <div className={compact ? "download-group compact" : "download-group"}>
      <div className={`platform-switch is-${platform}`} role="tablist" aria-label="Platform">
        <span className="platform-thumb" aria-hidden="true" />
        <button className={platform === "mac" ? "active" : ""} onClick={() => setPlatform("mac")} role="tab" aria-selected={platform === "mac"}>
          <AppleLogo weight="fill" /> macOS
        </button>
        <button className={platform === "windows" ? "active" : ""} onClick={() => setPlatform("windows")} role="tab" aria-selected={platform === "windows"}>
          <WindowsLogo weight="fill" /> Windows
        </button>
      </div>
      <a
        className="button primary"
        href={platform === "mac" ? MAC_DOWNLOAD_URL : WINDOWS_DOWNLOAD_URL}
      >
        {platform === "mac" ? <AppleLogo weight="fill" /> : <WindowsLogo weight="fill" />}
        {platform === "mac" ? copy.mac : copy.win}
      </a>
    </div>
  );
}

function HeroConsole({ copy }) {
  const [tab, setTab] = useState("download");
  const [copied, setCopied] = useState(false);

  const copyCommand = async () => {
    await navigator.clipboard.writeText(SOURCE_COMMAND);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="hero-console" aria-label="DeepSeeker installation options">
      <div className={`console-tabs is-${tab}`} role="tablist">
        <span className="console-tab-thumb" aria-hidden="true" />
        <button className={tab === "download" ? "active" : ""} onClick={() => setTab("download")} role="tab" aria-selected={tab === "download"}>{copy.directDownload}</button>
        <button className={tab === "source" ? "active" : ""} onClick={() => setTab("source")} role="tab" aria-selected={tab === "source"}>{copy.sourceInstall}</button>
      </div>
      <div className="console-window">
        <div className="console-bar"><span /><span /><span /></div>
        {tab === "download" ? (
          <div className="console-download console-panel">
            <DownloadButtons copy={copy} compact />
            <p>{copy.heroNote}</p>
          </div>
        ) : (
          <div className="command-row console-panel">
            <code><b>$</b> {SOURCE_COMMAND}</code>
            <button onClick={copyCommand} aria-label={copy.copy} title={copy.copy}><Copy /> {copied ? copy.copied : copy.copy}</button>
          </div>
        )}
      </div>
    </div>
  );
}

function Faq({ items }) {
  const [active, setActive] = useState(0);
  return (
    <div className="faq-list">
      {items.map(([question, answer], index) => {
        const expanded = active === index;
        return (
          <article className="faq-item reveal" key={question}>
            <button onClick={() => setActive(expanded ? -1 : index)} aria-expanded={expanded}>
              <Question />
              <span>{question}</span>
              <span className="faq-toggle">{expanded ? "−" : "+"}</span>
            </button>
            <div className={expanded ? "faq-answer open" : "faq-answer"}><p>{answer}</p></div>
          </article>
        );
      })}
    </div>
  );
}

function FeatureVisual({ active, content, type }) {
  const className = `feature-visual feature-${type}${active ? " active" : ""}`;

  if (type === "plugins") {
    return (
      <div className={className} aria-hidden={!active}>
        <div className="mock-toolbar">
          <strong>{content.title}</strong>
          <span><i />{content.status}</span>
        </div>
        <div className="plugin-grid">
          {content.items.map(([kind, name, status], index) => (
            <div className="plugin-tile" key={kind}>
              <div className={`plugin-mark mark-${index + 1}`} aria-hidden="true"><span /><span /></div>
              <small>{kind}</small>
              <strong>{name}</strong>
              <span>{status}</span>
            </div>
          ))}
        </div>
        <div className="mock-footer"><span>CORDIS</span><i /><i /><i /><b>event bus connected</b></div>
      </div>
    );
  }

  if (type === "trace") {
    return (
      <div className={className} aria-hidden={!active}>
        <div className="mock-toolbar">
          <strong>{content.title}</strong>
          <span className="session-id">{content.session}</span>
        </div>
        <div className="trace-list">
          {content.steps.map(([title, detail, status], index) => {
            const state = index < 2 ? "done" : index === 2 ? "running" : "queued";
            return (
              <div className={`trace-row ${state}`} key={title}>
                <div className="trace-node"><span>{index + 1}</span></div>
                <div className="trace-copy"><strong>{title}</strong><p>{detail}</p></div>
                <span className="trace-status">{status}</span>
              </div>
            );
          })}
        </div>
        <div className="trace-command"><span>$</span><code>deepseeker run --trace</code><i /></div>
      </div>
    );
  }

  return (
    <div className={className} aria-hidden={!active}>
      <div className="mock-toolbar">
        <strong>{content.title}</strong>
        <span><i />saved locally</span>
      </div>
      <div className="profile-layout">
        <div className="profile-list">
          <small>PROFILES</small>
          {content.profiles.map((profile, index) => (
            <div className={profile === content.selected ? "profile-option selected" : "profile-option"} key={profile}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{profile}</strong>
              {profile === content.selected ? <i /> : null}
            </div>
          ))}
        </div>
        <div className="profile-detail">
          <small>{content.modeLabel}</small>
          <h3>{content.mode}</h3>
          <div className="mode-selector"><span className="active">Standard</span><span>PTC</span><span>Minimal</span></div>
          <dl>
            {content.rows.map(([label, value]) => (
              <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
            ))}
          </dl>
          <div className="profile-ready"><i />Profile ready</div>
        </div>
      </div>
    </div>
  );
}

export function App() {
  const rootRef = useRef(null);
  const [lang, setLang] = useState("zh");
  const [activeFeature, setActiveFeature] = useState(0);
  const copy = COPY[lang];

  useEffect(() => {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  }, [lang]);

  useGSAP(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) return;

    gsap.from(".hero-copy > *", {
      autoAlpha: 0,
      y: 28,
      duration: 0.8,
      stagger: 0.08,
      ease: "power3.out",
    });
    gsap.from(".hero-console > *", { autoAlpha: 0, y: 40, duration: 1, delay: 0.2, stagger: 0.06, ease: "power3.out" });

    const heroCopy = rootRef.current.querySelector(".hero-copy");
    const heroConsole = rootRef.current.querySelector(".hero-console");
    gsap.set([heroCopy, heroConsole], { y: 0, opacity: 1, visibility: "visible" });
    ScrollTrigger.create({
      trigger: ".hero",
      start: "top top",
      end: "bottom top",
      scrub: 0.8,
      onUpdate: ({ progress }) => {
        gsap.set(heroCopy, { y: progress * 54, opacity: 1 - progress * 0.65, visibility: "visible" });
        gsap.set(heroConsole, { y: progress * 78, opacity: 1 - progress * 0.52, visibility: "visible" });
      },
      onRefresh: ({ progress }) => {
        gsap.set(heroCopy, { y: progress * 54, opacity: 1 - progress * 0.65, visibility: "visible" });
        gsap.set(heroConsole, { y: progress * 78, opacity: 1 - progress * 0.52, visibility: "visible" });
      },
    });

    gsap.utils.toArray(".reveal").forEach((element) => {
      gsap.from(element, {
        autoAlpha: 0,
        y: 34,
        duration: 0.8,
        ease: "power2.out",
        scrollTrigger: { trigger: element, start: "top 86%", toggleActions: "play none none reverse" },
      });
    });

    gsap.utils.toArray(".feature-step").forEach((element, index) => {
      ScrollTrigger.create({
        trigger: element,
        start: "top 52%",
        end: "bottom 48%",
        onEnter: () => setActiveFeature(index),
        onEnterBack: () => setActiveFeature(index),
      });
    });
  }, { scope: rootRef, dependencies: [lang], revertOnUpdate: true });

  return (
    <div ref={rootRef} className="site-shell" id="top">
      <Nav lang={lang} setLang={setLang} copy={copy} />

      <main>
        <section className="hero" aria-labelledby="hero-title">
          <AuroraCanvas />
          <div className="hero-grid">
            <div className="hero-copy">
              <p className="hero-label">{copy.heroLabel}</p>
              <h1 id="hero-title">{copy.headline}</h1>
              <p className="hero-principle">{copy.principle}</p>
              <p className="hero-body">{copy.heroBody}</p>
              <div className="hero-actions">
                <a className="button primary" href={GITHUB_URL} target="_blank" rel="noreferrer"><GithubLogo weight="fill" />{copy.github}</a>
                <a className="button ghost" href="#why">{copy.learnMore}<ArrowDown /></a>
              </div>
            </div>
            <HeroConsole copy={copy} />
          </div>
        </section>

        <section className="product-section section" id="product">
          <div className="product-heading reveal">
            <p className="section-label">{copy.productLabel}</p>
            <h2>{copy.productTitle}</h2>
            <p>{copy.productBody}</p>
          </div>
          <div className="product-layout">
            <div className="product-facts">
              {copy.productFeatures.map(([title, body], index) => {
                const Icon = PRODUCT_ICONS[index];
                return (
                  <article className="product-fact reveal" key={title}>
                    <Icon />
                    <div><h3>{title}</h3><p>{body}</p></div>
                  </article>
                );
              })}
            </div>
            <div className="product-visual reveal">
              <ProductWindow copy={copy} />
              <div className="product-proof">
                {copy.productProof.map((item) => <span key={item}><Check />{item}</span>)}
              </div>
            </div>
          </div>
        </section>

        <section className="why-section section" id="why">
          <div className="section-intro reveal">
            <p className="section-label">{copy.whyLabel}</p>
            <h2>{copy.whyTitle}</h2>
            <p>{copy.whyBody}</p>
          </div>
          <div className="pillar-grid">
            {copy.pillars.map(([title, english, body], index) => {
              const Icon = PILLAR_ICONS[index];
              return (
                <article className="pillar reveal" key={title}>
                  <Icon />
                  <h3>{title}</h3>
                  <span>{english}</span>
                  <p>{body}</p>
                </article>
              );
            })}
          </div>
        </section>

        <section className="feature-section section" id="features">
          <div className="section-intro feature-intro reveal">
            <p className="section-label">{copy.featureLabel}</p>
            <h2>{copy.featureTitle}</h2>
          </div>
          <div className="feature-story">
            <div className="feature-copy-column">
              {copy.features.map(([title, body], index) => (
                <article className={activeFeature === index ? "feature-step active" : "feature-step"} key={title}>
                  <span>0{index + 1}</span>
                  <h3>{title}</h3>
                  <p>{body}</p>
                </article>
              ))}
            </div>
            <div className="feature-stage" aria-live="polite">
              <div className="feature-frame">
                <div className="window-dots"><i /><i /><i /></div>
                {FEATURE_TYPES.map((type, index) => (
                  <FeatureVisual
                    active={activeFeature === index}
                    content={copy.featureUi[type]}
                    key={type}
                    type={type}
                  />
                ))}
              </div>
              <div className="feature-progress">
                {copy.features.map(([title], index) => (
                  <button key={title} className={activeFeature === index ? "active" : ""} onClick={() => setActiveFeature(index)} aria-label={title} />
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="demo-section section" id="demo">
          <div className="demo-heading reveal">
            <div>
              <p className="section-label">Demo</p>
              <h2>{copy.demoTitle}</h2>
            </div>
            <p>{copy.demoBody}</p>
          </div>
          <div className="app-preview-frame reveal">
            <div className="app-preview-bar">
              <div className="window-dots"><i /><i /><i /></div>
              <strong>DeepSeeker</strong>
              <span><i />{copy.previewNote}</span>
            </div>
            <div className="app-preview-media">
              <img src={assetUrl("deepseeker-app.png?v=20260816-light-restored")} alt={copy.productAlt} />
            </div>
          </div>
        </section>

        <section className="install-section section" id="download">
          <div className="section-intro reveal">
            <p className="section-label">{copy.installLabel}</p>
            <h2>{copy.installTitle}</h2>
          </div>
          <div className="steps-row">
            {copy.steps.map(([title, body], index) => {
              const Icon = STEP_ICONS[index];
              return (
                <article className="install-step reveal" key={title}>
                  <span>0{index + 1}</span>
                  <Icon />
                  <h3>{title}</h3>
                  <p>{body}</p>
                </article>
              );
            })}
          </div>
          <div className="download-panel reveal">
            <div>
              <h3>{copy.sourceTitle}</h3>
              <p>{copy.sourceBody}</p>
              <a className="button ghost" href={GITHUB_URL} target="_blank" rel="noreferrer"><GithubLogo weight="fill" />{copy.github}<ArrowRight /></a>
            </div>
            <DownloadButtons copy={copy} />
          </div>
        </section>

        <section className="open-section section" id="open-source">
          <div className="open-heading reveal">
            <p className="section-label">{copy.openLabel}</p>
            <h2>{copy.openTitle}</h2>
          </div>
          <div className="open-layout">
            <div className="open-copy reveal">
              <p>{copy.openBody}</p>
              <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="button ghost source-button">
                <GithubLogo weight="fill" /> {copy.openSource} <ArrowRight />
              </a>
            </div>
            <div className="license-panel reveal">
              <div className="mit-mark" aria-label="MIT License"><span>M</span><span>I</span><span>T</span><small>License</small></div>
              <ul>{copy.openChecks.map((item) => <li key={item}><Check />{item}</li>)}</ul>
            </div>
          </div>
        </section>

        <section className="faq-section section" id="faq">
          <div className="section-intro reveal"><h2>{copy.faqTitle}</h2></div>
          <Faq items={copy.faqs} />
        </section>

        <section className="cta-section">
          <AuroraCanvas compact />
          <div className="cta-copy reveal">
            <img src={assetUrl("whale.svg")} alt="" />
            <h2>{copy.ctaTitle}</h2>
            <p>{copy.ctaBody}</p>
            <DownloadButtons copy={copy} />
          </div>
        </section>
      </main>

      <footer>
        <Brand compact />
        <a href={HARNESS_URL} target="_blank" rel="noreferrer">{copy.attribution}</a>
        <span>{copy.footer}</span>
        <span>{copy.rights}</span>
      </footer>
    </div>
  );
}
