# constella_sdk.bootstrap —— 子进程入口 trampoline（ts 侧 sdk/src/bootstrap.ts 帧级
# 同构，T4-11；宿主生成 entry 薄脚本引用——`from constella_sdk.bootstrap import boot;
# boot(entry_mod.run)`，与 ts esbuild entry 对称）。
#
# stdout JSON 行协议（S-5① 冻结，02 §8.4/§14；stderr 不承载协议）：
#   {"type":"log","msg":"..."}                        ← ctx.log
#   {"type":"emit","branch":"...","payload":...}      ← ctx.emit（命令式分支发射）
#   {"type":"result","out":<NodeOut>,"runtime":{...}} ← 成功终帧（恰一且末行），exit 0
#   {"type":"error","name","message","code","stack"}  ← 失败终帧
# runtime={node,electron,execPath,sdkVersion}（K-01 §1；双运行时同构对照时剥除——§6.2）。
#   py 侧槽位值注记：node=子进程 python 解释器版本（字段名冻结、值随运行时）；electron
#   恒 None（py 无 process.versions.electron 对应物）；execPath=sys.executable。
# 退出码（S-5② 冻结）：0=成功；1=脚本自身错误（run 抛出、NodeOut 形状违规 OUT_INVALID、
# 能力 stub 抛错 SDK_CAP_UNAVAILABLE）；2=装配错误（ENTRY_NO_RUN/CTX_MISSING/
# CTX_INVALID_JSON，重试无意义）。
#
# 与 ts 侧的两处签名级映射（语义同构）：
#   - boot 为同步函数（内部 asyncio.run 驱动 async 流程；entry 冻结形不含 await）；
#   - 泛型异常名归一：ts `new Error(...)` ≍ py `Exception(...)`——帧 name 'Error'，
#     其余异常类按 type(e).__name__ 原样。
from __future__ import annotations

import asyncio
import inspect
import json
import os
import platform
import sys
import traceback
from typing import Any

from . import __version__
from .caps import unbound_cap
from .net import _NetCapClient, make_net_cap


class SdkError(Exception):
    """协议级错误（帧 name=SdkError，code 携带具体错误码；exit_code 1|2）。"""

    def __init__(self, code: str, message: str, exit_code: int) -> None:
        super().__init__(message)
        self.code = code
        self.exit_code = exit_code


def _send(obj: dict[str, Any]) -> None:
    # 帧行 LF 化：Windows 文本模式默认把 \n 译为 \r\n，ts process.stdout 不做翻译——
    # 归一为 \n 使两运行时帧行尾一致（帧语义对照本就不依赖行尾，此处为逐字节贴近）。
    sys.stdout.write(json.dumps(obj, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


class _Ctx:
    """NodeCtx 运行时形（log/sleep/emit 真实现；net=条件绑定〔T5-12b〕、余六 Cap=未绑定 stub）。

    sleep 接口为毫秒（与 ts 一致），内部换算 asyncio.sleep 秒。
    """

    __slots__ = (
        "params", "input", "browser", "llm", "net", "file", "im", "vault", "agent",
        "log", "sleep", "emit",
    )

    def __init__(self, params: dict[str, Any], input_value: Any, net_client: _NetCapClient | None = None) -> None:
        self.params = params
        self.input = input_value
        self.browser = unbound_cap("browser")
        self.llm = unbound_cap("llm")
        self.net = net_client if net_client is not None else unbound_cap("net")
        self.file = unbound_cap("file")
        self.im = unbound_cap("im")
        self.vault = unbound_cap("vault")
        self.agent = unbound_cap("agent")
        self.log = lambda msg: _send({"type": "log", "msg": str(msg)})
        self.sleep = lambda ms: asyncio.sleep(ms / 1000)

        async def emit(branch: str, payload: Any = None) -> None:
            _send({"type": "emit", "branch": branch, "payload": payload})

        self.emit = emit


def _validate_out(out: Any) -> None:
    """NodeOut 联合校验（02 §14）：恰含 data 或 branch 之一；branch 必须为字符串——违规=OUT_INVALID（exit 1）。"""
    if not isinstance(out, dict):
        raise SdkError("OUT_INVALID", "run 返回值必须是 { data } 或 { branch, ... } 对象（02 §14 NodeOut）", 1)
    has_data = "data" in out
    has_branch = "branch" in out
    if has_data == has_branch:
        raise SdkError("OUT_INVALID", "run 返回值须恰含 data 或 branch 之一（02 §14 NodeOut）", 1)
    if has_branch and not isinstance(out["branch"], str):
        raise SdkError("OUT_INVALID", "branch 必须为字符串（02 §14）", 1)


async def _invoke(user_run: Any, ctx: _Ctx) -> Any:
    # ts `await userRun(ctx)` 对非 Promise 返回值直通——同步 run（非 async def）同样支持
    result = user_run(ctx)
    if inspect.isawaitable(result):
        return await result
    return result


def _error_frame(e: BaseException) -> None:
    name = "Error" if type(e) is Exception else type(e).__name__
    code = getattr(e, "code", None)
    tb = "".join(traceback.format_exception(type(e), e, e.__traceback__)).rstrip("\n").split("\n")
    _send({
        "type": "error",
        "name": name,
        "message": str(e),
        "code": code,
        "stack": "\n".join(tb[:4]) or None,  # 与 ts 同取前 4 行（对照剥除；行号随实现变）
    })


def _boot(user_run: Any) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(newline="\n")
    # net 绑定判据（T0-06 会签：N1 权限类目含「网络」→宿主注入 CONSTELLA_NET_WS）——
    # 在场=真 cap、缺场=未绑定 stub（三态 unbound 语义不破，K-01 §6.1）。终帧后显式
    # close（与 ts 同构收尾——释放连接句柄；py 进程退出本亦回收 fd）。
    net_endpoint = os.environ.get("CONSTELLA_NET_WS")
    net_client = make_net_cap(net_endpoint) if net_endpoint else None
    try:
        if not callable(user_run):
            raise SdkError("ENTRY_NO_RUN", "脚本未导出 run(ctx)", 2)
        raw = os.environ.get("CONSTELLA_CTX")
        if not raw:
            raise SdkError("CTX_MISSING", "缺少 CONSTELLA_CTX 环境变量", 2)
        try:
            parsed = json.loads(raw)
        except ValueError:
            raise SdkError("CTX_INVALID_JSON", "CONSTELLA_CTX 不是合法 JSON", 2) from None
        ctx_dict = parsed if isinstance(parsed, dict) else {}
        ctx = _Ctx(ctx_dict.get("params") or {}, ctx_dict.get("input"), net_client)
        out = asyncio.run(_invoke(user_run, ctx))
        _validate_out(out)
        _send({
            "type": "result",
            "out": out,
            "runtime": {
                "node": platform.python_version(),
                "electron": None,
                "execPath": sys.executable,
                "sdkVersion": __version__,
            },
        })
        return 0
    except SdkError as e:
        _error_frame(e)
        return e.exit_code
    except Exception as e:  # noqa: BROAD_EXCEPT_OK —— trampoline 顶层边界：ts boot catch 全量同构，任何 run 内异常转错误帧
        _error_frame(e)
        return 1
    finally:
        if net_client is not None:
            net_client.close()  # 释放 net 连接（终帧已落）


def boot(user_run: Any) -> None:
    """子进程入口：构造 ctx → 驱动 run → 终帧 → 以退出码结束进程（0/1/2，S-5②）。"""
    sys.exit(_boot(user_run))
