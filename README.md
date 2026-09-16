# GPT Local Bridge

Windows 本地项目桥接工具：**Electron 控制面板 + Local Agent + MCP Bridge + OpenAI Secure MCP Tunnel**。

目标是让 ChatGPT 通过标准 MCP 工具访问用户明确授权的本地工作区，同时把路径校验、权限控制、命令白名单、审计和进程生命周期留在本机。

```text
ChatGPT Custom App
       ↓
OpenAI Secure MCP Tunnel
       ↓ outbound only
MCP Bridge 127.0.0.1:8788/mcp
       ↓ token-auth RPC
Local Agent 127.0.0.1:8787
       ↓
Allowed Workspaces
```

## v0.2.0

### ChatGPT / MCP

- 标准 **MCP Streamable HTTP** endpoint：`http://127.0.0.1:8788/mcp`。
- 暴露四个 MCP Tools：
  - `list_files`
  - `read_file`
  - `search_files`
  - `run_command`
- Electron 可监督官方 `tunnel-client`。
- Tunnel Runtime API Key **不写入 config.json**，只读取 `CONTROL_PLANE_API_KEY` 环境变量。
- 面板分别显示 Local Agent、MCP Bridge、Secure MCP Tunnel 状态，不再把“本机服务已运行”误显示成“ChatGPT 已连接”。

### 实时日志

控制面板可实时查看：

- `APP`：Electron 启停、配置变化。
- `AGENT`：Local Agent / RPC 成功与拒绝摘要。
- `MCP`：MCP session 和 tool call。
- `TUNNEL`：官方 tunnel-client stdout/stderr。

运行日志同时保存到 Electron `userData/runtime.log`，并可从界面直接定位。Bearer Token、Local Agent session token 和常见 `sk-...` 形式 API Key 在写日志前进行遮蔽。

Local Agent 的独立审计日志仍为 `audit.jsonl`，只记录请求 ID、工具、成功/失败、错误码和耗时，不记录文件正文。

### 本地安全边界

- Local Agent 仅监听 `127.0.0.1`。
- 每次 Electron 启动随机生成 Local Agent Bearer Token，renderer 和 MCP 外部客户端拿不到该 Token。
- 工作区白名单与 `realpath` 越界检查。
- 默认阻止 `.env`、`*.pem`、`*.key`、secret/password、浏览器存储等敏感路径。
- `run_command` 只允许既定 read-only / test 白名单，并以 command + args 数组启动，禁止任意 shell 字符串。
- 构建、写入、删除仍未开放；后续需要明确确认 Token、幂等和变更摘要后才能加入。

## Windows 一键使用

源码版下载/克隆后，可直接使用：

| 文件 | 用途 |
|---|---|
| `一键安装并启动.bat` | 首次安装依赖、语法检查并启动 |
| `一键启动.bat` | 日常启动；缺依赖时会自动安装 |
| `静默启动.bat` | 静默/最小化启动并驻留托盘 |
| `一键停止.bat` | 向已运行实例发送停止 Bridge 请求 |
| `一键构建Windows版.bat` | 构建 NSIS 安装包和 Portable EXE |

手动运行需要 Node.js 20+：

```bash
npm install
npm start
```

验证：

```bash
npm run check
npm run test:smoke
```

## 第一次配置

1. 双击 `一键安装并启动.bat`。
2. 在“允许的工作区”加入要让 ChatGPT 访问的项目目录。
3. 保存设置。
4. 确认 `Local Agent` 和 `MCP Bridge` 均显示“正常”。
5. 如果只需要测试本机工具，此时可运行“只读连通性测试”。
6. 如果要在 ChatGPT 当前聊天中使用，还需要配置 Secure MCP Tunnel。

完整步骤见：**[`docs/CHATGPT_MCP_SETUP.md`](docs/CHATGPT_MCP_SETUP.md)**。

## 为什么还需要 Tunnel

ChatGPT 不能直接访问你电脑上的 `127.0.0.1`。官方支持的本地/私网方案是 Secure MCP Tunnel：本机 `tunnel-client` 只建立出站连接，将 ChatGPT 的 MCP 请求转发到本机 MCP Bridge，而无需把 8788 端口直接暴露到公网。

官方入口：

- Tunnels：`https://platform.openai.com/settings/organization/tunnels`
- tunnel-client：`https://github.com/openai/tunnel-client/releases/latest`
- ChatGPT MCP / Developer Mode：`https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt`

## 在 ChatGPT 中实际使用

完成 Tunnel 和自定义 App 配置后，在 ChatGPT 中选择该 App（或在支持的界面中 `@` 提及）。例如：

```text
列出当前授权工作区根目录。
```

```text
读取 src/main.js 第 1 到 120 行。
```

```text
搜索项目中 startTunnel 的所有引用。
```

如果某条后续消息需要重新读取本地最新数据，需要再次选择/提及该 App。

> ChatGPT 自定义 MCP App 的可用能力取决于当前计划和工作区设置；写入类 MCP 权限与只读权限的开放范围可能不同。

## 默认端口

| 组件 | 默认地址 |
|---|---|
| Local Agent | `127.0.0.1:8787` |
| MCP Bridge | `http://127.0.0.1:8788/mcp` |
| tunnel-client health | `127.0.0.1:8790` |

三个端口都可在 Electron 面板中配置，且不能重复。

## Windows 开机静默启动

打包后的 Windows 应用可在面板勾选“Windows 登录后静默启动”。Electron 会使用 `--silent` 参数注册登录启动。

源码版可使用 `静默启动.bat`。

## 架构与安全

本项目不读取浏览器 Cookie/Token，不让网页端无条件访问整台电脑，也不会自动执行模型返回的任意 shell 字符串。

详细架构见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。
