# My QClaw Skills

My custom skills for QClaw (OpenClaw).

## Skills

- **bookmark-search** - Search local Chrome bookmarks
- **claude-code-monitor** - Monitor Claude Code session status
- **wechat-article-capture** - Capture WeChat public account articles

## Installation

```powershell
# Link to QClaw skills directory
New-Item -ItemType Junction -Path "$env:USERPROFILE\.qclaw\skills\<skill-name>" -Target "D:\QClaw\my-skills\<skill-name>"
```
