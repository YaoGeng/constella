# 场景 5（S-5 六形态之一）：{ branch } 路由交付 + ctx.emit 命令式分支发射
# （02 §14 NodeOut / demo L1019-1023）。
from constella_sdk import NodeCtx


def _num(v: object) -> int | float:
    """ts Number(v) 在六形态期望集内的等价物（None→0；数值原样）。"""
    if v is None:
        return 0
    if isinstance(v, bool):
        return int(v)
    if isinstance(v, (int, float)):
        return v
    return float(str(v))


async def run(ctx: NodeCtx) -> dict[str, object]:
    n = _num(ctx.input)
    if n % 2 == 1:
        await ctx.emit("odd", {"n": n})
    await ctx.sleep(5)
    return {"branch": "done", "doubled": n * 2}
