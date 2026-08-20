# Agent Note: 内置 DeepSeek 余额界面

Status: implemented

[English](2026-08-16-deepseek-balance-surface.md) | 中文

## Problem

DeepSeeker 已经能用配置好的 DeepSeek Key，但用户看不到账户还有多少钱。参考插件 `cn-scuo-oo/dsh-deepseek-quota` 的摆放位置有用，不过它还放了本地支付选项，以及一个从组件挂载时刻开始估算的“已用”数字。这两块都没有真实支付订单或权威用量数据撑着。

## Decision

`@deepseek-ai/dsh-client-ui-deepseek-balance` 是第一方双端插件。Host 每次请求都重新读取 `DEEPSEEK_API_KEY`，调用 DeepSeek 官方余额接口，校验文档里的金额字段，再从 `/deepseeker/deepseek-balance` 只返回整理后的余额。Key 缺失、无效和临时不可用都会在成功的同源响应里使用稳定错误码，避免 Chromium 把可渲染的账户状态记成资源加载失败。凭据和上游原始报错只留在 Host。

浏览器端注册一个 `sidebar.footer.action` 条目。侧栏展开时显示总余额、充值余额和赠送余额；每 60 秒刷新；不允许请求重叠；刷新失败时保留旧数据。点充值会先打开产品内弹窗，里面放 DeepSeek 官方充值页二维码和直达链接，支付细节仍由官网处理。侧栏收起时点 `¥` 就展开。窄屏会给卡片右侧留出空间，避开当前桌面宠物的悬浮区域。

## Alternatives considered

**原样安装参考插件。** 不采用。它的本地金额和支付方式选择会让人以为 DeepSeeker 掌握订单流程；“已用”也只是组件打开后余额减少了多少。官方页面二维码本身有用，所以保留为一个简单入口。

**让浏览器直接请求 DeepSeek。** 不采用。API Key 会暴露给浏览器代码和开发者工具。

## Consequences

Web 包和桌面依赖会带上同一套余额界面。这里显示的是余额，不是配额或账单用量。充值留在 DeepSeek 官网，卡片不会提交支付，也不会改用户凭据。
