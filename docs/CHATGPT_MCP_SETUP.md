# 在 ChatGPT 中使用 GPT Local Bridge

GPT Local Bridge 本身只在本机监听 `127.0.0.1`。ChatGPT 不能直接访问你电脑上的 localhost，因此完整链路需要 OpenAI Secure MCP Tunnel：

```text
ChatGPT
  ↓ Custom App / MCP
OpenAI Secure MCP Tunnel
  ↓ outbound tunnel-client
GPT Local Bridge MCP  http://127.0.0.1:8788/mcp
  ↓ local token-auth RPC
Local Agent            http://127.0.0.1:8787
  ↓
允许的本地工作区
```

## 1. 安装并启动 GPT Local Bridge

源码版 Windows 用户可直接双击：

- `一键安装并启动.bat`：首次安装依赖、检查语法并启动。
- `一键启动.bat`：日常启动。
- `静默启动.bat`：启动后不显示主窗口，驻留托盘。
- `一键停止.bat`：向已运行的 Electron 实例发送停止 Bridge 请求。
- `一键构建Windows版.bat`：构建 NSIS 安装包和 Portable 版本。

也可以手动执行：

```powershell
npm install
npm start
```

默认端口：

- Local Agent：`127.0.0.1:8787`
- MCP Bridge：`http://127.0.0.1:8788/mcp`
- tunnel-client 本地健康端口：`127.0.0.1:8790`

## 2. 配置允许的工作区

在 Electron 面板的“允许的工作区”中加入项目目录并保存。

Local Agent 仍然执行原有安全边界：

- 只允许工作区根目录及子目录。
- 路径先规范化并检查 realpath，阻止 `..` / 符号链接越界。
- 默认阻止 `.env`、密钥、password/secret、浏览器存储等敏感路径。
- `run_command` 只允许既定 read-only / test 白名单，不接受任意 shell 字符串。

## 3. 准备 OpenAI Secure MCP Tunnel

官方入口：

- Tunnels 管理：`https://platform.openai.com/settings/organization/tunnels`
- tunnel-client：`https://github.com/openai/tunnel-client/releases/latest`
- ChatGPT Developer Mode / MCP 帮助：`https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt`

需要：

1. 一个已创建的 `tunnel_id`。
2. 官方 `tunnel-client` 可执行文件。
3. 可用于该 Tunnel 的 Runtime API Key。

Runtime API Key **不要写进本仓库、config.json 或 Electron 输入框**。GPT Local Bridge 只读取进程环境变量：

```text
CONTROL_PLANE_API_KEY
```

Windows 可在“系统属性 → 环境变量 → 用户变量”中添加该变量，然后**完全退出并重新启动 GPT Local Bridge**，让 Electron 继承新的环境变量。

> 面板只显示“是否检测到 Runtime Key”，不会显示、记录或保存 Key 值。

## 4. 在 Electron 中启用 Tunnel

在“ChatGPT / Secure MCP Tunnel”区域：

1. 勾选“启用 Secure MCP Tunnel”。
2. `tunnel-client 可执行文件`：
   - 如果已加入 PATH，填 `tunnel-client`；
   - 否则填完整的 `.exe` 路径。
3. 填写 `Tunnel ID`。
4. 如需 Bridge 启动后自动连接，勾选“Bridge 启动时自动启动 Tunnel”。
5. 保存设置。
6. 点击“启动 Bridge”；如果未自动启动 Tunnel，再点击“启动 Tunnel”。

面板应依次显示：

```text
Local Agent        正常
MCP Bridge         正常
Secure MCP Tunnel  正常
```

“Tunnel 正常”表示本机 tunnel-client 的 `/readyz` 已就绪；它并不单独证明 ChatGPT 已经选择了这个自定义 App。

## 5. 在 ChatGPT 创建/连接自定义 App

ChatGPT 的具体入口会随计划与工作区权限变化。当前官方流程的核心是：

1. 在 ChatGPT 网页端启用 Developer Mode（如果你的计划/工作区提供该功能）。
2. 进入 Apps / Create 创建自定义 MCP App。
3. Connection 选择 **Tunnel**。
4. 选择或粘贴与 GPT Local Bridge 中相同的 `tunnel_id`。
5. 扫描工具并创建 App。

成功后应发现这些工具：

- `list_files`
- `read_file`
- `search_files`
- `run_command`

在聊天中选择该 App，或在支持的界面中 `@` 提及它，然后可以直接请求：

```text
列出当前工作区根目录。
```

```text
读取 src/main.js 的前 120 行。
```

```text
搜索项目中所有 startTunnel 的引用。
```

如果后续一条消息需要重新读取本地最新状态，请再次选择/提及该 App。

## 6. 实时日志

Electron 面板底部的“实时日志”同时显示：

- `APP`：Electron 生命周期、配置、启动/停止。
- `AGENT`：Local Agent 和 RPC 的成功/失败摘要。
- `MCP`：MCP session、tool call、MCP HTTP 错误。
- `TUNNEL`：官方 tunnel-client 的 stdout/stderr。

运行日志同时持久化到 Electron `userData` 目录中的：

```text
runtime.log
```

可在界面点击“打开日志文件”定位。

日志写入前会尝试遮蔽 Bearer Token、当前 Local Agent session token 和常见 `sk-...` API Key 格式。Local Agent 的独立结构化审计日志仍保存在 `audit.jsonl`，且不记录文件正文。

## 7. 常见问题

### Local Agent 正常，但 ChatGPT 还是不能用

这通常表示链路只完成了本机部分。必须同时满足：

1. MCP Bridge 正常；
2. tunnel-client 正常；
3. ChatGPT 自定义 App 使用相同 Tunnel；
4. 当前 ChatGPT 计划/工作区允许该 MCP App；
5. 发消息时已选择或 `@` 提及该 App。

### `CONTROL_PLANE_API_KEY` 未检测到

设置环境变量后，需要完全退出托盘中的 GPT Local Bridge，再重新启动。已经运行的 Electron 进程不会自动读取后来新增的系统环境变量。

### tunnel-client 启动后立即退出

查看 `TUNNEL` 日志。常见原因包括：

- 可执行文件路径错误；
- Tunnel ID 不存在或权限不足；
- Runtime API Key 不可用；
- Tunnel 与 ChatGPT workspace 不匹配；
- MCP Bridge 未就绪。

### 是否会自动修改项目文件？

当前 v0.2.0 **不会**。现阶段 MCP 暴露读取/搜索和受限验证命令；写入、构建和破坏性操作仍未开放，后续必须加入明确确认 Token、幂等和变更摘要后才能启用。
