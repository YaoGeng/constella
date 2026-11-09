# 场景 2（S-5 六形态之一，demo 契约主形态，02 §14 + demo L1032-1040）：
# PARAMS 默认值 ← ctx.params 覆盖；async/await + ctx.log/ctx.sleep。
# （ts 对照物 sdk/fixtures/s2-compute.ts；Number() 六形态内等价物见 _num。）
from constella_sdk import NodeCtx

PARAMS: dict[str, object] = {"factor": 2, "label": "score"}


def _num(v: object) -> int | float:
    """ts Number(v) 在六形态期望集内的等价物（None→0；数值原样；str 转数值）。"""
    if v is None:
        return 0
    if isinstance(v, bool):
        return int(v)
    if isinstance(v, (int, float)):
        return v
    return float(str(v))


async def run(ctx: NodeCtx) -> dict[str, object]:
    p = {**PARAMS, **(ctx.params or {})}
    ctx.log(f"factor={p['factor']}, input={ctx.input}")
    await ctx.sleep(10)
    v = _num(ctx.input if ctx.input is not None else 0) * _num(p["factor"])
    return {"data": {str(p["label"]): v}}
