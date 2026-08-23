# My QClaw Skills

我的 QClaw skill 仓库，换电脑 clone 下来就能用。

## 结构

```
自建/          ← 我自己写的 skill
收藏/          ← 从别处下载的好用 skill（附来源，方便更新）
```

## 自建 Skill

- **bookmark-search** — 搜索本地 Chrome 收藏夹
- **claude-code-monitor** — 监控 Claude Code 会话状态
- **markdown-comments** — 识别和处理 `chaos:` Markdown 批注，并用 Git 与贴身日志沉淀用户决策
- **wechat-article-capture** — 微信公众号文章抓取与收录

## 收藏 Skill

- **xiaohongshu-skills** — 小红书自动化（来源: github.com/xpzouying/xiaohongshu-skills）

## 使用方式

自建 skill 通过软链接或目录联结挂到各 Agent 的 skills 目录，改了就 commit + push。

收藏的 skill 备份在这里，需要时复制到 `~/.qclaw/skills/` 即可。
