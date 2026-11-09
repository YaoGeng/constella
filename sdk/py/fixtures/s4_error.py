# 场景 4（S-5 六形态之一）：错误抛出 —— 验证错误通道（stdout error 终帧 + exit 1，
# 宿主不依赖 stderr/退出码单通道）。
# 语义映射：ts `throw new Error(...)` → py `raise Exception(...)`；bootstrap 将泛型
# Exception 的帧 name 归一为 'Error'（跨运行时同构映射，bootstrap.py 注记）。
from constella_sdk import NodeCtx


async def run(ctx: NodeCtx) -> dict[str, object]:
    await ctx.sleep(5)
    ctx.log("about to fail")
    raise Exception(f"boom: {ctx.params.get('reason', 'unknown')}")
