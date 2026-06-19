---
name: claude-code-monitor
description: |
  监控本地 Claude Code 会话状态。通过读取 Claude Code 的 JSONL 会话日志，检测任务是否完成、正在工作或遇到限制。
  触发词：Claude Code 状态、Claude Code 在干嘛、终端监控、任务完成了吗、帮我盯着 Claude Code
---

## Claude Code Monitor

监控本地 Claude Code 终端会话的执行状态。

### 核心原理

Claude Code 把完整会话日志实时写入 JSONL 文件：
```
C:\Users\chaowi\.claude\projects\{project-path}\{session-id}.jsonl
```

日志包含：用户输入、模型回复、工具调用及结果、token 用量、会话标题等。
无需"偷看"终端窗口，直接读日志文件即可。

### 状态判断逻辑

| 状态 | 含义 | 判断条件 |
|------|------|----------|
| 🔄 working | 正在工作 | 最后 assistant 的 stop_reason = "tool_use" |
| ✅ just_finished | 刚完成一轮 | stop_reason = "end_turn" 且文件 < 3 分钟前更新 |
| 💤 likely_done | 可能完成 | stop_reason = "end_turn" 且文件 > 3 分钟无更新 |
| ⏸️ idle | 空闲 | 文件 > 10 分钟无更新 |
| ⚠️ limit_hit | token 上限 | stop_reason = "max_tokens" |

### 脚本用法

脚本路径：`D:\QClaw\skills\claude-code-monitor\scripts\monitor.js`

```bash
# 列出所有活跃会话
node D:\QClaw\skills\claude-code-monitor\scripts\monitor.js

# 查看指定会话
node D:\QClaw\skills\claude-code-monitor\scripts\monitor.js --session 19b60098

# 持续监控（每60秒检查一次，状态变化时输出）
node D:\QClaw\skills\claude-code-monitor\scripts\monitor.js --watch --interval 60

# 只输出有通知价值的（完成/空闲/限制）
node D:\QClaw\skills\claude-code-monitor\scripts\monitor.js --notify

# JSON 格式输出
node D:\QClaw\skills\claude-code-monitor\scripts\monitor.js --json
```

### 典型工作流

1. 用户说"帮我盯着 Claude Code" → 用 `--watch` 模式
2. 用户问"Claude Code 做完了吗" → 直接运行一次，检查状态
3. 需要推送到微信 → 用 `--notify` 模式，配合 cron 任务

### 通知推送（配合 cron）

可以创建 cron 任务，定期检查 Claude Code 状态并推送到微信：

```
# 每5分钟检查一次，完成时通知
openclaw cron add \
  --name "Claude Code 完成通知" \
  --every 5m \
  --session isolated \
  --agent main \
  --message "读取 Claude Code 会话状态。运行: node D:\QClaw\skills\claude-code-monitor\scripts\monitor.js --notify。如果有输出（任务完成/空闲/限制），直接把输出内容发给我。如果没有输出，回复 HEARTBEAT_OK。" \
  --announce --channel openclaw-weixin --to <user-id>
```

### 注意事项

- JSONL 文件是实时追加的，读取不会影响 Claude Code 运行
- 同一项目可能有多个会话（session-id 不同），按最后修改时间排序
- subagent 日志在 `{session-id}/subagents/` 子目录下
- 文件编码 UTF-8
