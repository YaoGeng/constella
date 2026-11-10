# constella_sdk "." —— 类型面＋identity 参考实现（02 §14 冻结契约；K-01 §1 py 段，T4-11；
# ts 对照物 sdk/src/index.ts）。
#
# NodeOut 纯数据形归 X-01：py 侧不 import X-01（跨语言不可达），以共享 fixture
# （sdk/fixtures/expected/*.json）对齐——K-01 §2 裁决「py 侧以共享 fixture 对齐」，
# 此处 TypedDict 形为 X-01 shared/src/dsl/node-out.ts 的同构复制（方向不可反转）。
# ctx 能力形（NodeCtx/各 Cap）归本包域。
#
# 运行链路注意：宿主 spawn 形参冻结 `python -I -X utf8 <entry>`（S-4）——禁依赖
# PYTHON* env（-I 隔离）；包目录与 entry 同置沙箱脚本目录、经 sys.path[0] 可达。
from __future__ import annotations

from typing import Awaitable, Protocol, TypedDict, Union

from .caps import (
    AgentCap,
    BrowserCap,
    FileCap,
    ImCap,
    LlmCap,
    LlmContentPart,
    LlmImagePart,
    LlmImageUrl,
    LlmMessage,
    LlmTextPart,
    NetCap,
    NetFetchResponse,
    SdkCapUnavailableError,
    VaultCap,
    unbound_cap,
)
from .net import DEFAULT_NET_FETCH_TIMEOUT_MS, SdkNetError, make_net_cap

__version__ = "0.1.0"  # 与 ts 侧 sdk/package.json version 恒等（T4-12 断言）

__all__ = [
    "DEFAULT_NET_FETCH_TIMEOUT_MS",
    "AgentCap",
    "BrowserCap",
    "FileCap",
    "ImCap",
    "LlmCap",
    "LlmContentPart",
    "LlmImagePart",
    "LlmImageUrl",
    "LlmMessage",
    "LlmTextPart",
    "NetCap",
    "NetFetchResponse",
    "NodeCtx",
    "NodeOut",
    "NodeOutBranch",
    "NodeOutData",
    "SdkCapUnavailableError",
    "SdkNetError",
    "VaultCap",
    "__version__",
    "make_net_cap",
    "run",
    "unbound_cap",
]


class NodeOutData(TypedDict):
    """单语义交付：向所有存活出边发 data（X-01 node-out.ts 同构复制）。"""

    data: object


class NodeOutBranch(TypedDict):
    """路由交付：只发 id===branch 的出边；其余键（meta 载荷）原样入 node_runs.output。

    TypedDict 不表达索引签名（ts `[meta: string]: unknown`）——多余键运行时原样透传。
    """

    branch: str


NodeOut = Union[NodeOutData, NodeOutBranch]


class NodeCtx(Protocol):
    """节点脚本运行上下文（02 §14 冻结成员集：params/input＋七 Cap＋log/sleep/emit）。"""

    params: dict[str, object]
    """合并后参数（脚本内置默认 ← config/*.yaml ← 节点实例 params——02 §14 覆盖顺序；合并归 C-M1）。"""

    input: object
    """上游交付数据（汇合=最后到达支；单入边=上游 data，02 §14）。"""

    browser: BrowserCap
    llm: LlmCap
    net: NetCap
    file: FileCap
    im: ImCap
    vault: VaultCap
    agent: AgentCap

    def log(self, msg: str) -> None: ...

    def sleep(self, ms: int) -> Awaitable[object]:
        """毫秒语义（与 ts sleep(ms): Promise<void> 一致；可中断语义归绑定实装/宿主强杀链路 C-M1）。"""
        ...

    async def emit(self, branch: str, payload: object = None) -> None:
        """命令式分支发射（组合节点内提前出口，demo L1019-1023；声明式见返回值 branch）。"""
        ...


async def run(ctx: NodeCtx) -> NodeOut:
    """SDK 参考实现（S-5 判据「from constella_sdk import run」值导入形态）：identity 透传。

    节点作者脚本各自定义 run，此参考实现供直接复用（ts 侧 `import { run } from '@constella/sdk'` 对称）。
    """
    return {"data": ctx.input}
