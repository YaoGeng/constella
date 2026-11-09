# constella_sdk.caps —— 七能力接口面（成员集=02 §14 逐字冻结，成员名保留 camelCase
# 契约原名）＋未绑定 stub 工厂（T4-11；ts 对照物 sdk/src/caps.ts）。
#
# V1.0 冻结面：本卡仅交付「未绑定 stub」——任一能力成员访问即抛 code=SDK_CAP_UNAVAILABLE。
# 绑定实装按 T0-06 会签结论随后续卡落位（browser=CONSTELLA_CDP_WS ws 客户端直连 lane 桥
# 〔包内置 RFC6455 极简文本帧客户端，stdlib〕；net=CONSTELLA_NET_WS 独立 NetProxyBridge；
# llm=LLM_BASE_URL/API_KEY env 直连；file/vault=本地无桥），届时仅替换 caps 实现、
# 能力接口形不变（K-01 §8① 替换点）。
# 注：§14 未标注返回形细目的成员以 list[object] 系占位（Session[] 等载荷形未冻结，绑定卡定形）。
from __future__ import annotations

from typing import Any, Literal, Protocol, TypedDict


class BrowserCap(Protocol):
    """browser 能力（02 §14：open/click/type/visible/extract/scrollCollect/scrollComments/extractNote/openChat/confirm/comment）。"""

    async def open(self, url: str) -> None: ...

    async def click(self, selector: str) -> None: ...

    async def type(self, selector: str, text: str) -> None: ...

    async def visible(self, selector: str) -> bool: ...

    async def extract(self, selector: str, attr: str) -> str | None: ...

    async def scrollCollect(
        self, kw: str, limit: int, sort: str | None = None, dedupe: bool | None = None
    ) -> list[object]: ...

    async def scrollComments(self, url: str) -> list[object]: ...

    async def extractNote(self, url: str, fields: list[str]) -> dict[str, object]: ...

    async def openChat(self, uid: str) -> None: ...

    async def confirm(self, sec: int) -> None: ...

    async def comment(self, text: str, rate: int | None = None) -> None: ...


class LlmTextPart(TypedDict):
    type: Literal["text"]
    text: str


class LlmImageUrl(TypedDict):
    url: str


class LlmImagePart(TypedDict):
    type: Literal["image_url"]
    image_url: LlmImageUrl


LlmContentPart = LlmTextPart | LlmImagePart


class LlmMessage(TypedDict):
    """llm 多模态消息（02 §14 G-2 裁定：messages 支持 image 输入——OpenAI 兼容 image_url 内容块）。"""

    role: Literal["system", "user", "assistant"]
    content: str | list[LlmContentPart]


class LlmCap(Protocol):
    """llm 能力（02 §14：json(prompt,temperature)->object / fill(template,who,tone,avoid)->string ＋多模态 messages）。"""

    async def messages(
        self, messages: list[LlmMessage], opts: dict[str, float] | None = None
    ) -> str: ...

    async def json(
        self, prompt: str, temperature: float | None = None
    ) -> dict[str, object]: ...

    async def fill(
        self, template: str, who: str, tone: str, avoid: str | None = None
    ) -> str: ...


class NetCap(Protocol):
    """net 能力（02 §14 G-2 裁定新增：fetch(url,{headers}) 经 main 网络代理；域名白名单=N1「网络」类目，白名单外 NET-DENIED）。"""

    async def fetch(
        self, url: str, init: dict[str, dict[str, str]] | None = None
    ) -> object: ...


class FileCap(Protocol):
    """file 能力（02 §14 G-2 裁定新增：read/write/list 限沙箱工作目录，路径逃逸拒绝——12.1）。"""

    async def read(self, path: str) -> str: ...

    async def write(self, path: str, data: str) -> None: ...

    async def list(self, path: str | None = None) -> list[str]: ...


class ImCap(Protocol):
    """im 能力（02 §14：pollUnread({cooldownMin,limit})->Session[] / send(convId,text)；Session 载荷形未冻结）。"""

    async def pollUnread(
        self, o: dict[str, int] | None = None
    ) -> list[object]: ...

    async def send(self, convId: str, text: str) -> None: ...


class VaultCap(Protocol):
    """vault 能力（02 §14：exec(op,input,cursor) / upsertNotes / recentSent(uid,n) / logChat）。"""

    async def exec(self, op: str, input: object, cursor: object = None) -> object: ...

    async def upsertNotes(self, notes: list[object]) -> None: ...

    async def recentSent(self, uid: str, n: int) -> list[object]: ...

    async def logChat(self, c: object) -> None: ...


class AgentCap(Protocol):
    """agent 能力（02 §14：reply(session,persona)->string|null）。"""

    async def reply(self, session: str, persona: str) -> str | None: ...


class SdkCapUnavailableError(Exception):
    """未绑定能力访问错误（错误帧 code=SDK_CAP_UNAVAILABLE，K-01 §6.1 三态之「unbound」）。"""

    code: str = "SDK_CAP_UNAVAILABLE"

    def __init__(self, cap: str, member: str) -> None:
        super().__init__(f"SDK_CAP_UNAVAILABLE:{cap}.{member}（能力未绑定；运行时绑定注入见 02 §14/§12.1）")


class _UnboundCap:
    """未绑定能力 stub：任一成员访问即抛 SdkCapUnavailableError（ts Proxy get 全拦截的同构物）。"""

    __slots__ = ("_cap",)

    def __init__(self, cap: str) -> None:
        self._cap = cap

    def __getattr__(self, member: str) -> Any:
        raise SdkCapUnavailableError(self._cap, member)


def unbound_cap(cap: str) -> Any:
    """stub 工厂：返回任一成员访问即抛错的未绑定能力对象（返回 Any=ts unboundCap<T> 泛型谎的同构翻译）。"""
    return _UnboundCap(cap)
