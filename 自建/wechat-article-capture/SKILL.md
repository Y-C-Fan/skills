---
name: wechat-article-capture
description: 微信公众号文章抓取与收录。用户发送 mp.weixin.qq.com 链接、要求抓取公众号全文、保存微信公众号文章、提取微信文章正文、收录每日什锦时使用。自动多 UA 抓取原始 HTML，提取 js_content 正文，保存 Markdown 到 D:\QClaw\articles，并可追加每日什锦 entries.jsonl。
---

# 微信公众号文章抓取

## 何时使用

用户发送 `https://mp.weixin.qq.com/...` 链接，或说“抓公众号”“保存微信文章”“收录这篇文章”“提取公众号全文”时使用。

## 标准流程

1. 运行脚本抓取全文，默认保存到 `D:\QClaw\articles`：

```powershell
node D:\QClaw\skills\wechat-article-capture\scripts\capture_wechat_article.js --url "<微信公众号链接>" --digest
```

2. 检查输出 JSON：
   - `ok: true`
   - `chars > 500`
   - `mdPath` 为 D 盘 Markdown 路径
   - `digest.added` 表示是否加入每日什锦

3. 给用户回复：标题、原文链接、全文路径、必要的极简摘要。

## 失败处理

- 如果脚本失败，不要直接放弃；先重试一次。
- 如果仍失败，保留错误信息，说明可能遇到微信验证/风控。
- 不要把临时 HTML 或大量调试输出发给用户。

## 存储规则

- 正文默认：`D:\QClaw\articles\<标题>.md`
- 临时 HTML：`D:\QClaw\tmp\wechat_<hash>.html`
- 每日什锦：`C:\Users\chaowi\.qclaw\workspace\daily-digest\YYYY-Www\entries.jsonl`

## 实现说明

脚本会：

- 使用多个 User-Agent 直接请求微信 HTML。
- 从 `msg_title` / `og:title` 提取标题。
- 从 `nickname` / `user_name` 提取来源。
- 从 `id="js_content"` 提取正文。
- HTML 转纯文本 Markdown。
- 可用 `--digest` 自动追加每日什锦条目。

## 回归测试链接

已验证过的链接类型：

```powershell
node D:\QClaw\skills\wechat-article-capture\scripts\capture_wechat_article.js --url "https://mp.weixin.qq.com/s/V727TpGvRjo5RvYRGZl6oA" --digest
node D:\QClaw\skills\wechat-article-capture\scripts\capture_wechat_article.js --url "https://mp.weixin.qq.com/s/oy8xzG363P73jTM57yzJTQ" --digest
```
