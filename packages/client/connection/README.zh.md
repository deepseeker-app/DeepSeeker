# @deepseek-ai/dsh-client-connection

[English](README.md) | 中文

协议消费层：客户端插件的 apply 会挂载 `ctx.connection`（共享 API 客户端 + 当前页面的 loopback 状态 + 可观察且按 generation 生效的 `hostDescription` + 单消费方流循环启动器）；导出表层携带协议约定类型、`AbstractApiClient` 抽象，以及循环的 sink／配置类型。每次就绪握手成功后，都会在 `onConnected` 之前发布完整的 `host.describe` 值；generation 失效或显式 stop 会清空它，因此原生能力消费者不会保留已经断线的判断。浏览器载体以 HTTP POST 发送 unary／respond，并为 `events.mux` 与 `events.host` 各开一条只下行的 WebSocket；进程内载体满足同一双流抽象。Host half 持有唯一 `/api` route 及其 Fetch bridge；已注册的 Typert interceptor 会先认领自己的 Remote endpoint，未认领请求再回退 API Proxy。Loopback hostname 判定逻辑留在包内部：`/api` Host fence 与 WebSocket upgrade 会直接使用它，其他客户端插件则消费派生的 `ctx.connection.isLoopback` 状态。node 半侧的 `/api` 路由把目录选择、目录浏览、建目录、打开路径和接入工作区（`host.pickDirectory`/`listDirectory`/`createDirectory`/`openPath`、`workspace.create`），以及整个配置面——`settings.describe`/`openDocument`/`update`/`replace`/`mutate` 与 `credentials.describe`/`set`/`unset`——都钉在回环本机；读取与原生操作也在内，因为 describe 会返回已暴露的配置、打开操作会作用于 Host 桌面，而探测任意引用会报出某条凭据来自何处。agent（智能体）preset 的创作面 `agentPreset.read`/`copy`/`openDocument`/`remove` 同样只限本机，因为组装指明了一个会话所运行的插件，读取它是侦察，而 copy/remove/openDocument 会管理名单并驱动宿主桌面；`agentPreset.list` 与 `agentPreset.select` 不在其中——名单只携带 id 与信任级别，而选择一个 preset 并不比 `session.create` 自带的 `agentPreset` 多给任何能力，何况默认 preset 本就带着 bash。远程端仍可拿已有 `workspaceId` 调 `session.create`，但不能自带 `cwd` 指向任意目录。平台载体与 ConnectionController 循环属于包内部；apply 负责选择并驱动它们。下行边界见 [WebSocket 下行载体 Agent Note](../../../.agents/notes/implemented/architecture/2026-08-04-websocket-downlink-carrier.md)。

## /api 浏览器信任栅栏

node 半侧在桥接或 upgrade 前守卫 `/api` 下的每个入口（`src/api-request-trust.ts`）。每个请求都必须带有效的服务权威，附带的浏览器标记也必须同源。真正的本机请求同时要求回环 `Host`、回环 TCP 对端，并且不能带代理客户端头；即使上游改写了 `Host`，LAN 客户端和 Cloudflare 回源请求也拿不到桌面快捷权限。挂载 `remote-web-ui/authorize-http` 后，它对每个非回环请求返回的 `allow` 或 `deny` 都是最终决定，所以已撤销的配对不会回落到 `trustedHosts`。打开 `requireRemoteAuthorization` 后，授权事件没有明确结果时，非回环 HTTP 请求和 WebSocket upgrade 直接拒绝。它默认关闭，旧部署仍可回落到 `trustedHosts`。没有该授权器时，这些旧部署仍可使用显式 `trustedHosts`：带端口精确匹配，不带端口则匹配任意端口，两侧均经 WHATWG 归一化。如果带 `Origin`，必须与 Host 完全一致；`sec-fetch-site: cross-site` 一律拒绝。格式错误的 `trustedHosts` 条目会让插件加载直接报错。HTTP 会在 RPC 分发前返回 403，WebSocket 会在事件流启动前拒绝握手。`remote-web-ui` 广播 `remote-web-ui/authorization-changed` 后，Connection 会重新检查所有已连接的非回环事件 WebSocket；已经失效的配对立即断开，本机连接不受影响。Web 运行时从全接口服务器配置推导 LAN IP 字面量，cordis.yml 中的 `trustedHosts` 与 CLI 的 `--trusted-host` flag 声明具名权威。决策记录：[api 浏览器信任边界 Agent Note](../../../.agents/notes/implemented/architecture/2026-07-28-api-browser-trust-boundary.md)。

## `/api` WebSocket 下行

`/api/events.mux` 与 `/api/events.host` 各接受一条 WebSocket upgrade，并只向浏览器发送对应的 `ServerRequest` 文本消息；客户端不会在这些 socket 上发送业务数据。任一 socket 结束都会使当前 connection generation 失败并重建两条流，连接就绪仍要求两条 socket 均已打开且 `host.describe` HTTP 调用成功。Host teardown 会终止两条 socket、中止各自的 source，并等待 source 清理完成后再返回。普通网络 GET 这些路径会返回 426，不保留 SSE（Server-Sent Events）回退；`toFetchHandler` 的 SSE 编解码只服务进程内同构载体。

## 模型体验

无。协议消费层只在浏览器与主机之间搬运已经组合好的消息；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **History 会恢复未附加的会话**：打开 history 可能创建宿主侧 agent，并增加首次打开的延迟；没有仅从持久化读取的路径。
- **`/api` 桥把每个请求体整体缓冲在内存里**：`maxRequestBodyBytes`（默认 160 MiB，按默认 100 MiB 图片总量上限经 base64 膨胀加信封余量得出）因此同时是单请求的驻留内存上界；要降低它而不缩小图片限额，需要流式请求体路径。
