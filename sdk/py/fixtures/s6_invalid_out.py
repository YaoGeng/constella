# 场景 6（S-5 六形态之一）：NodeOut 形状违规（既无 data 也无 branch）→ 必须走错误通道
# （code=OUT_INVALID, exit 1）而非静默成功。
from constella_sdk import NodeCtx


async def run(_ctx: NodeCtx) -> object:
    return {"wrong": 1}
