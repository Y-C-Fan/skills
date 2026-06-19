#!/usr/bin/env node
/**
 * Claude Code Session Monitor
 * 
 * 读取 Claude Code 的 JSONL 会话日志，检测任务状态。
 * 
 * 用法：
 *   node monitor.js                          # 列出所有活跃会话
 *   node monitor.js --session <id>           # 查看指定会话状态
 *   node monitor.js --watch                  # 持续监控（轮询模式）
 *   node monitor.js --watch --interval 30    # 每30秒检查一次
 *   node monitor.js --notify                 # 检测到完成时输出通知文本
 *   node monitor.js --json                   # JSON 格式输出
 */

const fs = require('fs');
const path = require('path');

// ── 配置 ──
const CLAUDE_PROJECTS_DIR = path.join(process.env.USERPROFILE || process.env.HOME, '.claude', 'projects');
const STALE_THRESHOLD_MS = 3 * 60 * 1000;  // 3 分钟无更新视为可能完成
const TAIL_LINES = 20;                       // 读取最后 N 行 JSONL

// ── 解析参数 ──
const args = process.argv.slice(2);
const flags = {};
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--session' && args[i + 1]) flags.session = args[++i];
  else if (args[i] === '--watch') flags.watch = true;
  else if (args[i] === '--interval' && args[i + 1]) flags.interval = parseInt(args[++i], 10);
  else if (args[i] === '--notify') flags.notify = true;
  else if (args[i] === '--json') flags.json = true;
  else if (args[i] === '--help') { printHelp(); process.exit(0); }
}

function printHelp() {
  console.log(`
Claude Code Session Monitor

用法：
  node monitor.js                          列出所有活跃会话
  node monitor.js --session <id>           查看指定会话状态
  node monitor.js --watch                  持续监控模式
  node monitor.js --watch --interval 30    每30秒检查（默认60秒）
  node monitor.js --notify                 完成时输出通知文本
  node monitor.js --json                   JSON 格式输出
`);
}

// ── 工具函数 ──

function findAllSessions() {
  if (!fs.existsSync(CLAUDE_PROJECTS_DIR)) return [];
  const sessions = [];
  
  const projectDirs = fs.readdirSync(CLAUDE_PROJECTS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => path.join(CLAUDE_PROJECTS_DIR, d.name));
  
  for (const dir of projectDirs) {
    const files = fs.readdirSync(dir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => path.join(dir, f));
    
    for (const file of files) {
      try {
        const stat = fs.statSync(file);
        const sessionId = path.basename(file, '.jsonl');
        sessions.push({
          sessionId,
          file,
          size: stat.size,
          lastModified: stat.mtimeMs,
          projectDir: path.basename(dir),
        });
      } catch (e) { /* skip */ }
    }
  }
  
  return sessions;
}

function readTailLines(filePath, n = TAIL_LINES) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n');
    return lines.slice(-n).map(line => {
      try { return JSON.parse(line); }
      catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
}

function getSessionStatus(session) {
  const now = Date.now();
  const age = now - session.lastModified;
  const lines = readTailLines(session.file);
  
  // 找最后一条 assistant 消息
  const lastAssistant = [...lines].reverse().find(l => l.type === 'assistant' && l.message);
  // 找最后一条 system/turn_duration
  const lastTurnDuration = [...lines].reverse().find(l => l.type === 'system' && l.subtype === 'turn_duration');
  // 找 last-prompt
  const lastPrompt = [...lines].reverse().find(l => l.type === 'last-prompt');
  // 找 ai-title
  const aiTitle = [...lines].reverse().find(l => l.type === 'ai-title');
  
  // 判断状态
  let status = 'unknown';
  let reason = '';
  
  if (lastAssistant) {
    const stopReason = lastAssistant.message?.stop_reason;
    const role = lastAssistant.message?.role;
    
    if (stopReason === 'tool_use') {
      status = 'working';
      reason = '正在调用工具';
    } else if (stopReason === 'end_turn') {
      if (age > STALE_THRESHOLD_MS) {
        status = 'likely_done';
        reason = `最后一轮完成于 ${Math.round(age / 1000)}秒前`;
      } else {
        status = 'just_finished';
        reason = '刚完成一轮';
      }
    } else if (stopReason === 'max_tokens') {
      status = 'limit_hit';
      reason = '达到 token 上限';
    }
  }
  
  if (age > 10 * 60 * 1000 && status !== 'working') {
    status = 'idle';
    reason = `${Math.round(age / 60000)} 分钟无更新`;
  }
  
  // 提取最后一条 assistant 的文本摘要
  let lastReply = '';
  if (lastAssistant?.message?.content) {
    const textBlock = lastAssistant.message.content.find(c => c.type === 'text');
    if (textBlock?.text) {
      lastReply = textBlock.text.slice(0, 200);
    }
  }
  
  // 提取工具调用信息
  let lastTool = '';
  if (lastAssistant?.message?.content) {
    const toolBlock = lastAssistant.message.content.find(c => c.type === 'tool_use');
    if (toolBlock) {
      lastTool = `${toolBlock.name}(${(toolBlock.input?.command || toolBlock.input?.description || '').slice(0, 80)})`;
    }
  }
  
  return {
    sessionId: session.sessionId,
    project: session.projectDir,
    cwd: lastAssistant?.cwd || lastPrompt?.sessionId || '',
    title: aiTitle?.aiTitle || '',
    status,
    reason,
    lastReply,
    lastTool,
    lastModified: new Date(session.lastModified).toISOString(),
    fileSize: `${Math.round(session.size / 1024)}KB`,
    ageSeconds: Math.round(age / 1000),
    lastPromptText: lastPrompt?.lastPrompt?.slice(0, 100) || '',
    model: lastAssistant?.message?.model || '',
    tokenUsage: lastAssistant?.message?.usage || null,
  };
}

// ── 输出格式化 ──

function formatStatus(s) {
  const statusEmoji = {
    working: '🔄',
    just_finished: '✅',
    likely_done: '💤',
    idle: '⏸️',
    limit_hit: '⚠️',
    unknown: '❓',
  };
  
  const emoji = statusEmoji[s.status] || '❓';
  let out = '';
  out += `${emoji} [${s.status}] ${s.title || s.sessionId}\n`;
  out += `   项目: ${s.project} | 模型: ${s.model}\n`;
  out += `   最后更新: ${s.lastModified} (${s.ageSeconds}秒前)\n`;
  out += `   原因: ${s.reason}\n`;
  if (s.lastTool) out += `   最后工具: ${s.lastTool}\n`;
  if (s.lastReply) out += `   最后回复: ${s.lastReply.slice(0, 120)}...\n`;
  if (s.lastPromptText) out += `   用户输入: ${s.lastPromptText.slice(0, 80)}...\n`;
  return out;
}

function formatNotify(s) {
  // 用于 cron 推送的精简格式
  if (s.status === 'likely_done' || s.status === 'idle') {
    return `✅ Claude Code 任务可能已完成\n\n📋 ${s.title || s.sessionId}\n📁 ${s.project}\n⏰ ${s.reason}\n\n${s.lastReply ? '💬 ' + s.lastReply.slice(0, 150) : ''}`;
  }
  if (s.status === 'limit_hit') {
    return `⚠️ Claude Code 达到 token 上限\n\n📋 ${s.title || s.sessionId}\n📁 ${s.project}`;
  }
  return '';
}

// ── 主逻辑 ──

function runOnce() {
  const sessions = findAllSessions();
  
  if (flags.session) {
    const target = sessions.find(s => s.sessionId.startsWith(flags.session));
    if (!target) {
      console.error(`找不到会话: ${flags.session}`);
      process.exit(1);
    }
    const status = getSessionStatus(target);
    if (flags.json) console.log(JSON.stringify(status, null, 2));
    else console.log(formatStatus(status));
    return;
  }
  
  // 列出所有会话
  const statuses = sessions
    .map(getSessionStatus)
    .sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
  
  if (flags.json) {
    console.log(JSON.stringify(statuses, null, 2));
    return;
  }
  
  if (flags.notify) {
    // 只输出有通知价值的
    for (const s of statuses) {
      const msg = formatNotify(s);
      if (msg) console.log(msg);
    }
    return;
  }
  
  // 默认：列表模式
  console.log(`\n📊 Claude Code 会话监控 (${statuses.length} 个会话)\n`);
  for (const s of statuses) {
    console.log(formatStatus(s));
  }
}

if (flags.watch) {
  const interval = (flags.interval || 60) * 1000;
  console.log(`👁️  监控模式启动，每 ${interval / 1000} 秒检查一次...\n`);
  
  // 记录上次状态，用于检测变化
  let lastStates = {};
  
  function check() {
    const sessions = findAllSessions();
    for (const session of sessions) {
      const status = getSessionStatus(session);
      const prev = lastStates[session.sessionId];
      
      if (prev && prev.status !== status.status) {
        // 状态变化！
        const now = new Date().toLocaleString('zh-CN');
        console.log(`\n[${now}] 🔄 状态变化: ${status.title || session.sessionId}`);
        console.log(`  ${prev.status} → ${status.status}`);
        console.log(`  ${status.reason}`);
        
        if (flags.notify && (status.status === 'likely_done' || status.status === 'idle' || status.status === 'just_finished')) {
          console.log('\n--- NOTIFY ---');
          console.log(formatNotify(status));
          console.log('--- END ---\n');
        }
      }
      
      lastStates[session.sessionId] = status;
    }
  }
  
  check();
  setInterval(check, interval);
} else {
  runOnce();
}
