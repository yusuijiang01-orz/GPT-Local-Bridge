# GPT Local Bridge

Windows 本地项目桥接工具：使用 **Electron** 提供桌面控制面板，以独立 **Local Agent** 子进程访问明确授权的工作区。目标是让上层 AI/网页客户端只提出结构化工具请求，本机服务负责路径校验、权限控制、执行与审计。

## 当前 MVP

- Electron 控制面板。
- 服务启动 / 停止。
- `--silent` 静默启动并驻留托盘。
- 打包后可选择 Windows 登录时用 `--silent` 自动启动。
- Local Agent 仅监听 `127.0.0.1`。
- 每次应用启动生成随机 Bearer Token，Token 不暴露给 renderer。
- 工作区白名单与 `realpath` 越界检查。
- 默认阻止 `.env`、`*.pem`、`*.key`、secret/password、浏览器存储等敏感路径。
- JSONL 审计记录。
- RPC：`list_files`、`read_file`、`search_files`、受限 `run_command`。
- 构建/写入命令在 MVP 中默认拒绝并返回 `CONFIRMATION_REQUIRED`，避免未经确认的破坏性操作。

## 运行

需要 Node.js 20+：

```bash
npm install
npm start
```

静默启动：

```bash
npm run start:silent
```

语法检查：

```bash
npm run check
```

## 使用

1. 启动应用。
2. 在“允许的工作区”中添加一个或多个目录并保存。
3. 保持“启动应用时自动启动服务”开启，或手动点击“启动服务”。
4. “只读连通性测试”会调用 `list_files`，用于验证工作区边界和本地 Agent 通信。
5. 关闭主窗口只会隐藏到托盘；托盘菜单可以再次显示面板、启动/停止服务或退出。

默认监听：`127.0.0.1:8787`。端口可在面板修改。

## 设计边界

本项目不读取浏览器 Cookie/Token，不允许网页端无条件访问整台电脑，也不会把模型返回的任意 shell 字符串直接执行。所有命令以参数数组传递且需通过本机 allowlist。

详细架构见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。
