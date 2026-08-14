import { useEffect, useRef, useState } from "react";
import {
  AppleLogo,
  ArrowDown,
  ArrowRight,
  ChatCircleDots,
  ChatsCircle,
  Check,
  Code,
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

const GITHUB_URL = "https://github.com/wuxie888/DeepSeeker";
const MAC_DOWNLOAD_URL = `${GITHUB_URL}/releases/latest/download/DeepSeeker-mac-arm64.zip`;
const assetUrl = (path) => `${import.meta.env.BASE_URL}${path}`;
const clamp = (value, min = 0, max = 1) => Math.min(Math.max(value, min), max);

const COPY = {
  zh: {
    nav: ["产品", "下载", "开源", "FAQ"],
    eyebrow: "DEEPSEEK HARNESS 桌面端",
    headline: "DeepSeeker",
    subhead: "把 DeepSeek Harness 装进电脑",
    intro: "下载，填入 API Key，马上开始。",
    mac: "下载 macOS",
    win: "Windows 即将推出",
    github: "GitHub",
    scroll: "继续往下",
    stepsTitle: "开始使用，只需三步",
    steps: [
      ["下载并安装", "打开安装包，把 DeepSeeker 放进应用程序。"],
      ["填入 API Key", "在设置里填入 DeepSeek API Key，只保存在本机。"],
      ["开始对话", "选一个文件夹，直接把任务交给它。"],
    ],
    productTitle: "本地桌面 AI 智能体，专注真实工作",
    productKicker: "打开就能干活",
    features: [
      ["本地桌面访问", "文件、终端和工作内容留在你的电脑里。"],
      ["对话工作区", "不同任务分开聊，历史记录随时接着做。"],
      ["文件与上下文", "它能读懂项目里的文件，也能记住你正在做什么。"],
      ["开源与社区", "跟随 DeepSeek Harness 更新，代码公开，谁都能检查。"],
    ],
    proof: ["本机运行", "文件上下文", "Session log"],
    openTitle: "开源、透明、可自由使用",
    openBody: "DeepSeeker 基于 DeepSeek Harness，代码按 MIT License 开放。你可以自己查看、修改，也可以跟着项目一起更新。",
    source: "在 GitHub 查看源码",
    checks: ["可以自由使用", "可以修改分发", "可以检查代码", "不用绑定账号"],
    faqTitle: "常见问题",
    faqs: [
      ["DeepSeeker 需要本地运行服务吗？", "不用。桌面端会把运行环境一起带上，普通用户不需要安装 Node.js 或 Python。"],
      ["如何获取 DeepSeek API Key？", "去 DeepSeek 开放平台创建即可。首次打开 DeepSeeker 时，设置页会引导你填入。"],
      ["是开源的吗？", "是。DeepSeeker 按 MIT License 开源，核心能力来自同样开源的 DeepSeek Harness。"],
      ["有哪些大模型支持？", "第一版先把 DeepSeek 跑稳，后续会按桌面端的实际使用需求继续接入。"],
      ["我的数据会传到云端吗？", "文件读取、会话和工作区都在本机。调用模型时，只会把完成当前任务需要的内容发给你配置的模型服务。"],
      ["如何参与贡献？", "直接在 GitHub 提 Issue 或 PR。"],
    ],
    footer: "基于 DeepSeek Harness 构建",
    rights: "© 2026 DeepSeeker. MIT License.",
  },
  en: {
    nav: ["Product", "Download", "Open Source", "FAQ"],
    eyebrow: "DEEPSEEK HARNESS FOR DESKTOP",
    headline: "DeepSeeker",
    subhead: "DeepSeek Harness, ready on your desktop",
    intro: "Download. Add your API key. Start working.",
    mac: "Download for macOS",
    win: "Windows coming soon",
    github: "GitHub",
    scroll: "Keep scrolling",
    stepsTitle: "Get started in three steps",
    steps: [
      ["Download", "Open the installer and move DeepSeeker to Applications."],
      ["Add an API key", "Paste your DeepSeek API key. It stays on this device."],
      ["Start a task", "Choose a folder and tell DeepSeeker what needs doing."],
    ],
    productTitle: "A local desktop agent built for real work",
    productKicker: "Open it and get to work",
    features: [
      ["Local desktop access", "Files, terminals, and active work stay on your computer."],
      ["Conversation workspaces", "Keep tasks separate and pick up where you left off."],
      ["Files and context", "It reads project files and understands the work in front of you."],
      ["Open source", "Track DeepSeek Harness releases and inspect every line of code."],
    ],
    proof: ["Runs locally", "File context", "Session log"],
    openTitle: "Open, inspectable, and yours to use",
    openBody: "DeepSeeker is built on DeepSeek Harness and released under the MIT License. Read it, change it, and keep it current with the upstream project.",
    source: "View source on GitHub",
    checks: ["Free to use", "Modify and distribute", "Inspect the code", "No account lock-in"],
    faqTitle: "Questions",
    faqs: [
      ["Do I need to run a local service?", "No. The desktop build brings its runtime with it, so there is no Node.js or Python setup."],
      ["Where do I get a DeepSeek API key?", "Create one on the DeepSeek Platform. DeepSeeker will guide you through setup on first launch."],
      ["Is it open source?", "Yes. DeepSeeker is released under the MIT License and is powered by the open-source DeepSeek Harness."],
      ["Which models are supported?", "The first release focuses on a solid DeepSeek experience. More providers can follow where desktop users need them."],
      ["Does my data go to the cloud?", "Workspaces, files, and sessions stay local. Only context required for the current task is sent to your configured model service."],
      ["How can I contribute?", "Open an Issue or send a PR on GitHub."],
    ],
    footer: "Built on DeepSeek Harness",
    rights: "© 2026 DeepSeeker. MIT License.",
  },
};

const STEP_ICONS = [DownloadSimple, Key, ChatCircleDots];
const FEATURE_ICONS = [Desktop, ChatsCircle, FileText, Code];

function Brand({ compact = false }) {
  return (
    <a className="brand" href="#top" aria-label="DeepSeeker home">
      <img src={assetUrl("whale.svg")} alt="" />
      <span className={compact ? "brand-name compact" : "brand-name"}>DeepSeeker</span>
    </a>
  );
}

function Nav({ lang, setLang, copy }) {
  const [open, setOpen] = useState(false);
  const links = ["#product", "#download", "#open-source", "#faq"];

  return (
    <header className="site-nav" data-nav>
      <Brand />
      <nav className={open ? "nav-links open" : "nav-links"} aria-label="Primary navigation">
        {copy.nav.map((item, index) => (
          <a key={item} href={links[index]} onClick={() => setOpen(false)}>{item}</a>
        ))}
      </nav>
      <div className="nav-actions">
        <div className="language-switch" aria-label="Language">
          <button className={lang === "zh" ? "active" : ""} onClick={() => setLang("zh")}>中文</button>
          <span>/</span>
          <button className={lang === "en" ? "active" : ""} onClick={() => setLang("en")}>EN</button>
        </div>
        <button className="menu-button" onClick={() => setOpen((value) => !value)} aria-label="Toggle navigation">
          {open ? <X weight="bold" /> : <List weight="bold" />}
        </button>
      </div>
    </header>
  );
}

function ProductWindow({ className = "" }) {
  const frameRef = useRef(null);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;
    let animationFrame = 0;
    const move = (event) => {
      const rect = frame.getBoundingClientRect();
      const px = (event.clientX - rect.left) / rect.width - 0.5;
      const py = (event.clientY - rect.top) / rect.height - 0.5;
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(() => {
        frame.style.setProperty("--tilt-x", `${-py * 3}deg`);
        frame.style.setProperty("--tilt-y", `${px * 4}deg`);
        frame.style.setProperty("--tilt-shift-x", `${px * 6}px`);
        frame.style.setProperty("--tilt-shift-y", `${py * 4}px`);
      });
    };
    const leave = () => {
      frame.style.removeProperty("--tilt-x");
      frame.style.removeProperty("--tilt-y");
      frame.style.removeProperty("--tilt-shift-x");
      frame.style.removeProperty("--tilt-shift-y");
    };
    frame.addEventListener("pointermove", move);
    frame.addEventListener("pointerleave", leave);
    return () => {
      cancelAnimationFrame(animationFrame);
      frame.removeEventListener("pointermove", move);
      frame.removeEventListener("pointerleave", leave);
    };
  }, []);

  return (
    <div ref={frameRef} className={`product-window ${className}`}>
      <div className="window-bar">
        <div className="traffic-lights"><i /><i /><i /></div>
        <span>DeepSeeker</span>
        <span className="window-mode">Workspace</span>
      </div>
      <img src={assetUrl("deepseeker-app.jpg")} alt="DeepSeeker desktop application showing a real agent conversation" />
    </div>
  );
}

function DownloadControls({ copy }) {
  const [platform, setPlatform] = useState("mac");
  return (
    <div className="download-controls" id="download">
      <div className="platform-tabs" role="tablist" aria-label="Platform">
        <button className={platform === "mac" ? "active" : ""} onClick={() => setPlatform("mac")} role="tab" aria-selected={platform === "mac"}>
          <AppleLogo weight="fill" /> macOS
        </button>
        <button className={platform === "windows" ? "active" : ""} onClick={() => setPlatform("windows")} role="tab" aria-selected={platform === "windows"}>
          <WindowsLogo weight="fill" /> Windows
        </button>
      </div>
      <div className="download-buttons">
        <a
          className={platform === "windows" ? "primary-button disabled" : "primary-button"}
          href={platform === "mac" ? MAC_DOWNLOAD_URL : undefined}
          aria-disabled={platform === "windows"}
          onClick={platform === "windows" ? (event) => event.preventDefault() : undefined}
        >
          {platform === "mac" ? <AppleLogo weight="fill" /> : <WindowsLogo weight="fill" />}
          {platform === "mac" ? copy.mac : copy.win}
        </a>
        <a className="secondary-button" href={GITHUB_URL} target="_blank" rel="noreferrer">
          <GithubLogo weight="fill" /> {copy.github}
        </a>
      </div>
    </div>
  );
}

function SectionHeading({ children }) {
  return (
    <div className="section-heading reveal">
      <span className="signal-line" aria-hidden="true" />
      <h2>{children}</h2>
      <span className="signal-line reverse" aria-hidden="true" />
    </div>
  );
}

function Faq({ items }) {
  const [active, setActive] = useState(0);
  return (
    <div className="faq-grid">
      {items.map(([question, answer], index) => {
        const expanded = active === index;
        return (
          <article className="faq-item reveal" key={question}>
            <button onClick={() => setActive(expanded ? -1 : index)} aria-expanded={expanded}>
              <Question weight="bold" />
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

export function App() {
  const rootRef = useRef(null);
  const [lang, setLang] = useState("zh");
  const copy = COPY[lang];

  useEffect(() => {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  }, [lang]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;

    const observed = root.querySelectorAll(".reveal, .step-card, .feature-row");
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    }, { threshold: 0.14, rootMargin: "0px 0px -8%" });
    observed.forEach((element) => observer.observe(element));

    const hero = root.querySelector(".hero");
    const heroCopy = root.querySelector(".hero-copy");
    const heroWindow = root.querySelector(".hero-window");
    const stepsGrid = root.querySelector(".steps-grid");
    const stepProgress = root.querySelector(".step-progress");
    const featureSection = root.querySelector(".feature-section");
    const featureVisual = root.querySelector(".feature-visual");
    let animationFrame = 0;

    const updateScrollMotion = () => {
      animationFrame = 0;
      const viewportHeight = Math.max(window.innerHeight, 1);
      const desktop = window.innerWidth >= 780;
      const heroRect = hero?.getBoundingClientRect();
      if (heroRect && heroCopy && heroWindow) {
        const progress = clamp(-heroRect.top / Math.max(heroRect.height, 1));
        heroWindow.style.setProperty("--parallax-y", `${-progress * (desktop ? 72 : 18)}px`);
        heroCopy.style.setProperty("--copy-y", `${progress * (desktop ? 80 : 24)}px`);
        heroCopy.style.setProperty("--copy-opacity", `${1 - progress * 0.65}`);
      }

      const stepsRect = stepsGrid?.getBoundingClientRect();
      if (stepsRect && stepProgress) {
        const progress = clamp((viewportHeight * 0.76 - stepsRect.top) / Math.max(stepsRect.height * 0.62, 1));
        stepProgress.style.setProperty("--step-progress", `${progress}`);
      }

      const featureRect = featureSection?.getBoundingClientRect();
      if (desktop && featureRect && featureVisual) {
        const progress = clamp((viewportHeight - featureRect.top) / (viewportHeight + featureRect.height));
        featureVisual.style.setProperty("--feature-y", `${(0.5 - progress) * 62}px`);
      }
    };
    const onScroll = () => {
      if (animationFrame) return;
      animationFrame = requestAnimationFrame(updateScrollMotion);
    };

    requestAnimationFrame(() => root.classList.add("motion-ready"));
    updateScrollMotion();
    const settleTimer = window.setTimeout(updateScrollMotion, 180);
    window.addEventListener("pageshow", onScroll);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(animationFrame);
      window.clearTimeout(settleTimer);
      window.removeEventListener("pageshow", onScroll);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return (
    <div ref={rootRef} className="site-shell" id="top">
      <AuroraCanvas />
      <Nav lang={lang} setLang={setLang} copy={copy} />

      <main>
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-beam" aria-hidden="true" />
          <img className="hero-whale" src={assetUrl("whale.svg")} alt="" />
          <div className="hero-copy">
            <p className="eyebrow">{copy.eyebrow}</p>
            <h1 id="hero-title">{copy.headline}</h1>
            <p className="hero-subhead">{copy.subhead}</p>
            <p className="hero-intro">{copy.intro}</p>
            <DownloadControls copy={copy} />
          </div>
          <ProductWindow className="hero-window" />
          <a className="scroll-cue" href="#steps"><span>{copy.scroll}</span><ArrowDown /></a>
        </section>

        <section className="steps-section section" id="steps">
          <SectionHeading>{copy.stepsTitle}</SectionHeading>
          <div className="steps-grid">
            <div className="step-progress" aria-hidden="true" />
            {copy.steps.map(([title, body], index) => {
              const Icon = STEP_ICONS[index];
              return (
                <article className="step-card" key={title}>
                  <span className="step-index">0{index + 1}</span>
                  <div className="step-icon"><Icon weight="duotone" /></div>
                  <h3>{title}</h3>
                  <p>{body}</p>
                </article>
              );
            })}
          </div>
        </section>

        <section className="feature-section section" id="product">
          <div className="feature-heading reveal">
            <p>{copy.productKicker}</p>
            <h2>{copy.productTitle}</h2>
          </div>
          <div className="feature-layout">
            <div className="feature-list">
              {copy.features.map(([title, body], index) => {
                const Icon = FEATURE_ICONS[index];
                return (
                  <article className="feature-row" key={title}>
                    <div className="feature-icon"><Icon weight="duotone" /></div>
                    <div><h3>{title}</h3><p>{body}</p></div>
                  </article>
                );
              })}
            </div>
            <div className="feature-visual reveal">
              <ProductWindow />
              <div className="proof-strip">
                {copy.proof.map((item, index) => <span key={item}><Check weight="bold" />{item}{index < 2 && <i />}</span>)}
              </div>
            </div>
          </div>
        </section>

        <section className="open-section section" id="open-source">
          <SectionHeading>{copy.openTitle}</SectionHeading>
          <div className="open-layout">
            <div className="open-copy reveal">
              <p>{copy.openBody}</p>
              <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="secondary-button source-button">
                <GithubLogo weight="fill" /> {copy.source} <ArrowRight />
              </a>
            </div>
            <div className="license-panel reveal">
              <div className="mit-mark" aria-label="MIT License"><span>M</span><span>I</span><span>T</span><small>License</small></div>
              <ul>{copy.checks.map((item) => <li key={item}><Check weight="bold" />{item}</li>)}</ul>
            </div>
          </div>
        </section>

        <section className="faq-section section" id="faq">
          <SectionHeading>{copy.faqTitle}</SectionHeading>
          <Faq items={copy.faqs} />
        </section>
      </main>

      <footer>
        <Brand compact />
        <span>{copy.footer}</span>
        <span>{copy.rights}</span>
      </footer>
    </div>
  );
}
