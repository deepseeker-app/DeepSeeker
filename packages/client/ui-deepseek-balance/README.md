# @deepseek-ai/dsh-client-ui-deepseek-balance

English | [中文](README.zh.md)

Built-in DeepSeek account-balance surface. The Host half resolves `DEEPSEEK_API_KEY` through the credential service for each request, calls DeepSeek's official `GET /user/balance` endpoint, validates the response, and publishes a normalized record through a read-only same-origin route. The API key and upstream error body never reach the browser. Missing, invalid, and temporarily unavailable states use stable codes in a successful same-origin response so the browser can render them without reporting a failed resource load.

The browser half adds a compact card to `sidebar.footer.action`. It shows total, topped-up, and granted balances, refreshes every 60 seconds, and keeps the last successful value when a refresh fails. Its top-up action opens an in-app launcher with a QR code and a direct link to DeepSeek's official top-up page; amount and payment confirmation remain on DeepSeek. A collapsed sidebar shows a `¥` control that expands the column. Low balance is an advisory display state only.

The product direction was informed by [`cn-scuo-oo/dsh-deepseek-quota`](https://github.com/cn-scuo-oo/dsh-deepseek-quota). This implementation keeps the official-page QR launcher but deliberately omits that project's local amount picker, payment-method picker, and mount-relative “used” estimate: DeepSeeker has no authoritative payment order or usage-ledger data for those surfaces.

## Model Experience

None, as this package renders account balance for a human and touches no prompt, message, schema, stream, tool result, or session log.

#### KV Cache effect

None; this package does not alter prompts, tools, or provider requests.

## Known Limitations and Deferred Work

- The official API reports account balance, not a rate-limit quota or usage ledger.
- Automatic refresh runs while the card is mounted; there is no background notification when DeepSeeker is closed.
- The top-up launcher only opens or encodes DeepSeek's official page. Payment remains entirely outside DeepSeeker.
- Currency support follows the currently documented `CNY` and `USD` records.
