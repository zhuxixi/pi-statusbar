# pi-statusbar: 透出扩展状态为 footer 第三行 — 设计文档

- 日期：2026-08-27
- Issue：zhuxixi/pi-statusbar#5
- 状态：用户已认可方案（2026-08-27 对话确认）

## 背景与问题

pi 提供扩展状态广播机制：任何扩展可调用 `ctx.ui.setStatus(key, text)` 把状态写入
全局表（`FooterDataProvider.extensionStatuses`，一个 `Map<key, text>`，值可含 ANSI
色码）。内置 `FooterComponent` 渲染时读取该表（`getExtensionStatuses()`），把非空
状态渲染成 footer 的额外一行（footer.js:205-218）。

pi-statusbar 通过 `ctx.ui.setFooter(factory)` 完全替换内置 footer，渲染自己的两行
布局（line1: user@host / cwd / session title / cache / cost / time；line2: git
slug+branch / model / effort / ctx%）。替换后无人再读取 extensionStatuses，扩展
写入的状态丢失显示。

## 目标

- 有扩展状态时，在两行 footer 下追加第三行，显示全部状态
- 无状态时保持两行，现有布局零回归
- 其他扩展零改动（继续用 `ctx.ui.setStatus`，无需感知 pi-statusbar）

## 非目标

- 不做配置开关（YAGNI）
- 不拦截/修改扩展写入的状态值（原样透出，含 ANSI 色码）
- 不改动 line1/line2 的任何渲染逻辑

## 设计

### 数据流

1. 扩展调用 `ctx.ui.setStatus(key, text)` → pi 写入 FooterDataProvider 内部 Map
2. pi-statusbar 的 render() 调用 `footerData.getExtensionStatuses()` 读取
   `ReadonlyMap<string, string>`
3. 状态非空 → 渲染第三行；为空 → 只返回两行

### 刷新时机（关键约束）

FooterDataProvider **不提供状态变化回调**（唯一变更通知是 git 分支的
`onBranchChange`）。`setExtensionStatus` 直接改 Map，不触发任何重绘。因此：

- 新增 10 秒 interval 轮询：每 tick 读 `getExtensionStatuses()`，与上次快照做
  浅比较（size + 逐 key 值），**内容变化才 `tui.requestRender()`**。
- 比较成本 O(n)，n = 状态条数（通常 < 10），可忽略。
- 快照在 tick 检测到变化时更新；render() 直接读当前 Map，不依赖快照。
- dispose() 清理 interval。

### 第三行渲染规则（照抄内置 footer，保持生态一致）

1. 按 key 字母序排序（`localeCompare`）
2. 每条文本 sanitize：`[\r\n\t]` → 空格、折叠连续空格、trim
3. `join(" ")`
4. `truncateToWidth(statusLine, width, theme.fg("dim", "..."))` 截断到终端宽
5. 不额外包裹颜色——值自带的 ANSI 色码原样保留

### 组件契约

`lib/statusline.ts` 新增纯函数（零 pi 依赖、注入 width 函数、可单测）：

- `sanitizeStatusText(text: string): string`
  — `text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim()`
- `formatExtensionStatuses(statuses: ReadonlyMap<string, string>): string`
  — 排序 + sanitize + join(" ")，空表返回 ""
- `statusesChanged(prev: ReadonlyMap<string, string>, next: ReadonlyMap<string, string>): boolean`
  — size 不同即 true；否则逐 key 比较值

`index.ts`（入口）改动：

- footer factory 内新增 10s interval + 快照变量（模块级或 factory 闭包内），
  变化才 requestRender；dispose() 里 clearInterval
- render() 里：
  ```ts
  const statusLine = formatExtensionStatuses(footerData.getExtensionStatuses());
  if (statusLine) lines.push(truncateToWidth(statusLine, width, dim("...")));
  ```
- 无其他改动（不触碰 line1/line2 构造、/statusbar 命令、config）

### 错误处理

- `getExtensionStatuses()` 无抛错路径（直接读内部 Map）
- sanitize 对任意字符串安全；轮询 tick 无 IO，无需 try/catch
- 若状态值含非预期 Unicode，truncateToWidth 用 grapheme 宽度安全截断（pi-tui 保证）

## 布局示例

有状态（第三行出现）：

```text
user@host  ~/project  <session>                          R6.7M CH99.9%  2026-08-27 08:00
owner/repo | git:(main)                   (provider) model • max • ctx:27.11%
💳 dt $0.01/$199.99   🔌 MCP: 7 servers enabled
```

无状态（与今天完全一致的两行）：第三行不出现。

## 测试计划

`test/statusline.test.ts` 新增（沿用现有 esbuild+node 单测方式）：

- `sanitizeStatusText`：换行/制表符 → 空格、连续空格折叠、首尾 trim
- `formatExtensionStatuses`：key 排序稳定、join 分隔、空表 → ""
- `statusesChanged`：相同 false / 新增 true / 删除 true / 值变化 true / 仅插入顺序变化 false
- 截断：`truncateToWidth` 已有 pi-tui 实现，入口行截断沿用（不额外单测，属胶水层）
