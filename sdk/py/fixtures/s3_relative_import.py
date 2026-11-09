# 场景 3（S-5 六形态之一）：外部相对 import 的 py 对照物（py 包导入语义）——
# ts 侧 './lib/helper.ts' 相对 import 在 py 侧为 `from lib.helper import normalize`
# （lib/ 与本模块同置沙箱脚本目录，经 sys.path[0] 解析）；JSON import 属性 → json.load；
# node:crypto sha256 → hashlib（同为 stdlib，摘要逐字节一致）。
import hashlib
import json
from pathlib import Path

from constella_sdk import NodeCtx
from lib.helper import normalize

_ITEMS: dict[str, list[str]] = json.loads(
    (Path(__file__).parent / "lib" / "items.json").read_text(encoding="utf-8")
)


async def run(ctx: NodeCtx) -> dict[str, object]:
    key = normalize(str(ctx.params.get("key", " x ")))
    digest = hashlib.sha256(f"{key}::{ctx.input}".encode("utf-8")).hexdigest()[:12]
    return {"data": {"key": key, "tags": "|".join(_ITEMS["tags"]), "hash": digest}}
