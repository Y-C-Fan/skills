# -*- coding: utf-8 -*-
"""
search_bookmarks.py — 在本地 Chrome 收藏夹里模糊搜索

用法:
  python search_bookmarks.py <关键词> [关键词2] ...
  python search_bookmarks.py "云图库"
  python search_bookmarks.py 字节 实习
  python search_bookmarks.py --limit 20 LeetCode

参数:
  --limit N   最多返回 N 条（默认 15）
  --json      以 JSON 输出（方便程序解析）

匹配:
  对每条书签，把 [标题 + URL + 文件夹路径] 拼成一个 haystack，
  对每个关键词做大小写不敏感的匹配（精确子串优先，模糊子序列兜底）；
  多个关键词为 AND 关系。按"标题命中 > URL 命中 > 路径命中"打分排序。
"""
import json, os, sys, argparse
from urllib.parse import urlparse

# Windows 终端默认 GBK，强制 stdout 用 UTF-8 才能输出中文+emoji
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

# Chrome 把书签分成两个文件，都尝试读
CANDIDATES = [
    os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\User Data\Default\AccountBookmarks"),
    os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\User Data\Default\Bookmarks"),
]

def load_all():
    """读取并合并所有存在的书签源，返回扁平 list[{name,url,path}]"""
    all_items = []
    for p in CANDIDATES:
        if not os.path.exists(p):
            continue
        try:
            with open(p, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception as e:
            print(f"[warn] 无法读取 {p}: {e}", file=sys.stderr)
            continue

        def walk(node, path):
            if node.get("type") == "url":
                all_items.append({
                    "name": node.get("name", ""),
                    "url":  node.get("url", ""),
                    "path": " / ".join(path),
                    "source": os.path.basename(p),
                })
            elif node.get("children"):
                new_path = path + [node.get("name", "")] if path else [node.get("name", "")]
                for c in node["children"]:
                    walk(c, new_path)

        for k, root in data.get("roots", {}).items():
            if isinstance(root, dict) and "children" in root:
                walk(root, [k])

    # 同 URL 去重（合并不同来源的同一个书签）
    seen, deduped = {}, []
    for it in all_items:
        key = it["url"].rstrip("/").lower()
        if key in seen:
            continue
        seen[key] = True
        deduped.append(it)
    return deduped

def fuzzy_subsequence(haystack, needle):
    """判断 needle 的字符是否按顺序出现在 haystack 中（子序列匹配）"""
    if not needle:
        return True
    hi = 0
    for ch in needle:
        found = haystack.find(ch, hi)
        if found == -1:
            return False
        hi = found + 1
    return True


def match_score(haystack, kw):
    """对单个关键词在 haystack 中匹配打分。
    精确子串命中 = 10 分，模糊子序列命中 = 6 分，未命中 = 0。"""
    if kw in haystack:
        return 10  # 精确子串
    if fuzzy_subsequence(haystack, kw):
        return 6   # 模糊子序列
    return 0


def score(item, kws):
    """给一条书签打分：标题 > URL > 路径，精确 > 模糊；任一关键词不命中则返回 0"""
    name_l = item["name"].lower()
    url_l  = item["url"].lower()
    path_l = item["path"].lower()
    s = 0
    for kw in kws:
        kw = kw.lower()
        # 依次在标题、URL、路径中匹配，取最高分
        best = max(match_score(name_l, kw),
                   match_score(url_l, kw),
                   match_score(path_l, kw))
        if best == 0:
            return 0   # AND 语义：任一关键词没命中就淘汰
        s += best
    return s

def main():
    ap = argparse.ArgumentParser(description="搜索本地 Chrome 收藏夹")
    ap.add_argument("keywords", nargs="*", help="一个或多个关键词（空格分隔，AND 关系）")
    ap.add_argument("--limit", type=int, default=15, help="最多返回多少条（默认 15）")
    ap.add_argument("--json", action="store_true", help="以 JSON 输出")
    ap.add_argument("--dump", action="store_true", help="输出全部书签（供大模型做语义搜索）")
    args = ap.parse_args()

    items = load_all()
    if not items:
        print("[error] 没有读到任何 Chrome 书签。", file=sys.stderr)
        print(f"        预期路径之一存在文件: {CANDIDATES[0]}", file=sys.stderr)
        sys.exit(1)

    # --dump 模式：输出全部书签，供大模型语义搜索
    if args.dump:
        out = [{"idx": i, "name": it["name"], "url": it["url"], "path": it["path"]}
               for i, it in enumerate(items, 1)]
        print(json.dumps({"total": len(items), "bookmarks": out}, ensure_ascii=False, indent=2))
        return

    if not args.keywords:
        ap.error("请提供搜索关键词，或使用 --dump 输出全部书签")

    scored = [(score(it, args.keywords), it) for it in items]
    hits = sorted([(s, it) for s, it in scored if s > 0], key=lambda x: -x[0])[:args.limit]

    if args.json:
        out = [{"score": s, **it} for s, it in hits]
        print(json.dumps({"total_bookmarks": len(items),
                          "matched": len(hits),
                          "keywords": args.keywords,
                          "results": out}, ensure_ascii=False, indent=2))
        return

    # 人类可读输出
    print(f"在 {len(items)} 个本地书签中搜索 [{' AND '.join(args.keywords)}] —— 命中 {len(hits)} 条\n")
    if not hits:
        print("（没有匹配。试试更短的关键词、或拆成多个词。）")
        return
    for i, (s, it) in enumerate(hits, 1):
        host = urlparse(it["url"]).netloc
        print(f"{i:>2}. [{s:>2}分]  {it['name']}")
        print(f"        🔗 {it['url']}")
        print(f"        📁 {it['path']}  ({host})")
        print()

if __name__ == "__main__":
    main()
