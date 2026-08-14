/** Durable settings namespace for product-wide GUI onboarding facts. */
export const WELCOME_NOTICE_SETTINGS_NAMESPACE = 'ui-onboarding'

/** Field storing the last welcome notice version the user acknowledged. */
export const WELCOME_NOTICE_ACK_FIELD = 'welcomeNoticeVersion'

/**
 * Bump only when the notice changes materially and every user should see it
 * again. The acknowledgement is compared for exact equality.
 */
export const WELCOME_NOTICE_VERSION = '2026-08-14.1'

/** The complete editable first-run welcome in both supported GUI locales. */
export const WELCOME_NOTICE_COPY = {
  zh: {
    title: '欢迎使用 DeepSeeker',
    body: 'DeepSeeker 目前还是早期版本，部分功能会跟着 DeepSeek Harness 快速更新。\n\n接下来只需要添加一个 DeepSeek API Key。Key 保存在本机，之后打开应用就能直接使用。',
    continueLabel: '开始设置',
  },
  en: {
    title: 'Welcome to DeepSeeker',
    body: 'DeepSeeker is still an early release, and some features will change as DeepSeek Harness evolves.\n\nNext, add a DeepSeek API key. It stays on this device, so future launches are ready to use.',
    continueLabel: 'Get started',
  },
} as const
