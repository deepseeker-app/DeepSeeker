# @deepseek-ai/dsh-client-ui-deepseek-balance

[English](README.md) | 中文

DeepSeek 内置账户余额界面。Host 每次请求都会通过凭据服务读取 `DEEPSEEK_API_KEY`，调用 DeepSeek 官方 `GET /user/balance` 接口，校验返回值，再通过只读的同源接口把整理后的余额交给浏览器。API Key 和上游原始报错都不会发到浏览器。Key 缺失、无效和临时不可用会在成功的同源响应里使用稳定错误码，浏览器可以正常显示这些状态，也不会把它们记成资源加载失败。

浏览器端会在 `sidebar.footer.action` 放一张紧凑的余额卡。它显示总余额、充值余额和赠送余额，每 60 秒刷新一次；刷新失败时保留上一次成功数据。点充值会先打开产品内弹窗，里面有 DeepSeek 官方充值页二维码和直达链接；金额与支付方式仍在官网确认。侧栏收起时只显示 `¥`，点击后展开。低余额只是提醒，不会替用户做任何操作。

产品方向参考了 [`cn-scuo-oo/dsh-deepseek-quota`](https://github.com/cn-scuo-oo/dsh-deepseek-quota)。这个实现保留官方页面二维码弹窗，删掉了本地金额选择、支付方式选择和按组件挂载时间推算的“已用”数字。DeepSeeker 手里没有真实支付订单，也没有权威用量账本，不能拿假流程糊弄用户。

## 模型体验

无，因为这个包只给用户显示账户余额，不会接触提示词、消息、schema、流、工具结果或 Session 日志。

#### KV Cache 影响

无；本包不会改提示词、工具或 provider 请求。

## 已知限制与暂缓事项

- 官方接口给的是账户余额，不是限流配额，也不是用量账单。
- 自动刷新只在卡片挂载时运行；DeepSeeker 关闭后不会在后台提醒。
- 充值弹窗只编码或打开 DeepSeek 官方页面，支付全程不经过 DeepSeeker。
- 货币支持跟随目前官方文档里的 `CNY` 和 `USD`。
