# TDD-K-01 §6.1 py 侧 net 绑定验收（T5-12b）——ctx.net 绑定客户端（constella_sdk.net）
# 双层判定：
#   ① 进程内客户端用例（make_net_cap 直测——与 ts 侧 sdk/test/net-cap.test.ts 同覆盖面）；
#   ② 子进程 bootstrap 装配面（CONSTELLA_NET_WS 在场→真 cap／缺场→SDK_CAP_UNAVAILABLE，
#      与 ts 侧 contract.test.ts「caps net 绑定三态」段同判据）。
#
# 桥 mock=内联 Python 极简 ws 服务端（stdlib——镜像 sdk/test/mini-net-bridge.ts 语义：
# 按 params.url 脚本化 {ok:true,result}｜{ok:false,error}，未匹配默认 NET-DENIED；
# mode=silent/close-on-message/close-after-reply 供超时/关闭/重连面）。
# ts/py 同构终判归 sdk/test/isomorphism.mjs（同一 ts mini 桥下两侧帧序列对照）。
#
# 运行：`py -I -X utf8 sdk/py/tests/run_net.py`（py 启动器解析 3.12.10=S-4 锁定版；
# Windows PATH python 为 WindowsApps stub——sdk/py/README.md 解释器口径）。
# allow: SIZE_OK —— 单文件入口（run_contract.py 同惯例；-I 下拆分兄弟模块需自带垫片）。
from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import os
import shutil
import socket
import subprocess
import sys
import threading
from pathlib import Path
from typing import Any

PY_ROOT = Path(__file__).resolve().parent.parent  # sdk/py
PKG_SRC = PY_ROOT / "constella_sdk"
SANDBOX = PY_ROOT / ".tmp" / "net" / "sandbox"
CHILD_TIMEOUT_S = 15.0

sys.dont_write_bytecode = True
sys.path.insert(0, str(PY_ROOT))  # 进程内导入 constella_sdk（子进程=沙箱同置包，-I 前置垫片）

OK_BODY = "constella net ✓ 网络代理"
WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


# ————————————————————————————————————————————
# 极简 ws 服务端（stdlib；仅本验收所需子集）
# ————————————————————————————————————————————

class MiniNetServer:
    """mock net 桥（T0-07 统一帧形）——replies[url] 脚本化应答；mode 见文件头。"""

    def __init__(self, replies: dict[str, dict[str, Any]] | None = None, mode: str = "normal") -> None:
        self.replies = replies or {}
        self.mode = mode
        self.connections = 0
        self.requests: list[dict[str, Any]] = []
        self._conns: set[socket.socket] = set()
        self._srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self._srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self._srv.bind(("127.0.0.1", 0))
        self._srv.listen(4)
        self._port = self._srv.getsockname()[1]
        self._thread = threading.Thread(target=self._serve, daemon=True)

    @property
    def url(self) -> str:
        return f"ws://127.0.0.1:{self._port}"

    def start(self) -> str:
        self._thread.start()
        return self.url

    def stop(self) -> None:
        try:
            self._srv.close()
        except OSError:
            pass
        for conn in list(self._conns):
            try:
                conn.close()
            except OSError:
                pass

    def _serve(self) -> None:
        while True:
            try:
                conn, _ = self._srv.accept()
            except OSError:
                return  # listener 已关
            threading.Thread(target=self._handle, args=(conn,), daemon=True).start()

    def _handle(self, conn: socket.socket) -> None:
        self._conns.add(conn)
        self.connections += 1
        try:
            self._handshake(conn)
            buf = bytearray()
            while True:
                message, buf = self._read_message(conn, buf)
                self._dispatch(conn, message)
        except (OSError, ConnectionError):
            pass  # 对端关闭/重置——连接生命周期终点
        finally:
            self._conns.discard(conn)
            try:
                conn.close()
            except OSError:
                pass

    @staticmethod
    def _read_exact(conn: socket.socket, buf: bytearray, n: int) -> bytes:
        while len(buf) < n:
            chunk = conn.recv(65536)
            if not chunk:
                raise ConnectionError("peer closed")
            buf += chunk
        out = bytes(buf[:n])
        del buf[:n]
        return out

    def _handshake(self, conn: socket.socket) -> None:
        head = bytearray()
        while b"\r\n\r\n" not in head:
            chunk = conn.recv(4096)
            if not chunk:
                raise ConnectionError("peer closed")
            head += chunk
        lines = bytes(head).split(b"\r\n")
        key = ""
        for line in lines[1:]:
            name, _, value = line.partition(b":")
            if name.strip().lower() == b"sec-websocket-key":
                key = value.strip().decode("ascii")
        accept = base64.b64encode(hashlib.sha1((key + WS_GUID).encode("ascii")).digest()).decode("ascii")
        conn.sendall(
            (
                "HTTP/1.1 101 Switching Protocols\r\n"
                "Upgrade: websocket\r\n"
                "Connection: Upgrade\r\n"
                f"Sec-WebSocket-Accept: {accept}\r\n"
                "\r\n"
            ).encode("ascii")
        )

    def _read_message(self, conn: socket.socket, buf: bytearray) -> tuple[bytes, bytearray]:
        """收取一条完整文本消息（客户端帧必掩码——解掩码；close→镜像后抬连接终点）。"""
        message = b""
        got_first = False
        while True:
            b1 = self._read_exact(conn, buf, 1)[0]
            fin = (b1 & 0x80) != 0
            opcode = b1 & 0x0F
            b2 = self._read_exact(conn, buf, 1)[0]
            masked = (b2 & 0x80) != 0
            length = b2 & 0x7F
            if length == 126:
                length = int.from_bytes(self._read_exact(conn, buf, 2), "big")
            elif length == 127:
                length = int.from_bytes(self._read_exact(conn, buf, 8), "big")
            mask = self._read_exact(conn, buf, 4) if masked else b""
            payload = bytearray(self._read_exact(conn, buf, length))
            if masked and payload:
                for i in range(length):
                    payload[i] ^= mask[i % 4]
            if opcode == 0x8:  # close——镜像
                self._send_frame(conn, b"", opcode=0x8)
                raise ConnectionError("client close")
            if opcode == 0x9:  # ping→pong
                self._send_frame(conn, bytes(payload), opcode=0xA)
                continue
            if opcode == 0xA:
                continue
            if opcode in (0x1, 0x2):
                message = bytes(payload)
                got_first = True
            elif opcode == 0x0 and got_first:
                message += bytes(payload)
            else:
                continue
            if fin:
                return message, buf

    @staticmethod
    def _send_frame(conn: socket.socket, payload: bytes, opcode: int = 0x1) -> None:
        n = len(payload)
        head = bytearray([0x80 | opcode])
        if n < 126:
            head.append(n)
        elif n < 65536:
            head.append(126)
            head += n.to_bytes(2, "big")
        else:
            head.append(127)
            head += n.to_bytes(8, "big")
        conn.sendall(bytes(head) + payload)  # 服务端帧不掩码（RFC6455）

    def _dispatch(self, conn: socket.socket, message: bytes) -> None:
        try:
            rec = json.loads(message.decode("utf-8"))
        except ValueError:
            conn.close()
            return
        if not isinstance(rec, dict) or not isinstance(rec.get("id"), int):
            conn.close()
            return
        frame_id = rec["id"]
        params = rec.get("params") if isinstance(rec.get("params"), dict) else {}
        url = params.get("url") if isinstance(params.get("url"), str) else ""
        self.requests.append({"id": frame_id, "params": params})
        if self.mode == "close-on-message":
            conn.close()
            return
        if self.mode == "silent":
            return
        reply = self.replies.get(url) or {
            "ok": False,
            "error": {"code": "NET-DENIED", "message": f"域名白名单外默认拒绝: {url}"},  # 未脚本化=默认拒（白名单镜像）
        }
        self._send_frame(conn, json.dumps({"id": frame_id, **reply}, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
        if self.mode == "close-after-reply":
            self._send_frame(conn, b"", opcode=0x8)
            conn.close()


def b64(text: str) -> str:
    return base64.b64encode(text.encode("utf-8")).decode("ascii")


def main_replies() -> dict[str, dict[str, Any]]:
    return {
        "https://ok.example.com/api": {
            "ok": True,
            "result": {"status": 200, "statusText": "OK", "headers": {"content-type": "text/plain; charset=utf-8", "x-mini": "1"}, "bodyB64": b64(OK_BODY)},
        },
        "https://ok.example.com/notfound": {
            "ok": True,
            "result": {"status": 404, "statusText": "Not Found", "headers": {}, "bodyB64": b64("nope")},
        },
        "https://dead.example.com/unreachable": {
            "ok": True,
            "result": {"status": 0, "statusText": "网络失败: getaddrinfo ENOTFOUND dead.example.com", "headers": {}, "bodyB64": ""},
        },
        "https://evil.example.net/exfil": {
            "ok": False,
            "error": {"code": "NET-DENIED", "message": "域名白名单外默认拒绝: evil.example.net"},
        },
    }


# ————————————————————————————————————————————
# ① 进程内客户端用例
# ————————————————————————————————————————————

def fetch(cap: Any, url: str, init: dict[str, Any] | None = None) -> Any:
    return asyncio.run(cap.fetch(url, init))


def expect_net_error(promise: Any, code: str, message_contains: str | None = None) -> None:
    try:
        asyncio.run(promise)
    except Exception as e:  # noqa: BLE001 —— 判定需捕获一切非契约异常
        if not type(e).__name__ == "SdkNetError":
            raise AssertionError(f"应抛 SdkNetError{{code:{code}}}，实际 {type(e).__name__}: {e}") from e
        assert e.code == code, f"code 应为 {code}，实际 {e.code}"
        if message_contains is not None:
            assert message_contains in str(e), f"message 应含 {message_contains!r}，实际 {str(e)!r}"
        return
    raise AssertionError(f"应抛 SdkNetError{{code:{code}}}，实际未抛")


def inprocess_problems() -> list[str]:
    from constella_sdk import make_net_cap
    from constella_sdk.net import SdkNetError

    problems: list[str] = []
    main = MiniNetServer(replies=main_replies())
    main.start()
    try:
        cap = make_net_cap(main.url)

        # bound 帧往返：utf8 body 解码/headers 透传/请求 headers 上桥
        res = fetch(cap, "https://ok.example.com/api", {"headers": {"x-probe": "constella"}})
        expect = {"status": 200, "statusText": "OK", "headers": {"content-type": "text/plain; charset=utf-8", "x-mini": "1"}, "body": OK_BODY}
        if res != expect:
            problems.append(f"ok result 映射不符: {res!r} != {expect!r}")
        last = main.requests[-1]
        if last["params"] != {"url": "https://ok.example.com/api", "headers": {"x-probe": "constella"}} or last["id"] != 1:
            problems.append(f"请求面（params/id）不符: {last!r}")

        # init 缺省 → params 仅 url
        fetch(cap, "https://ok.example.com/api")
        if main.requests[-1]["params"] != {"url": "https://ok.example.com/api"}:
            problems.append(f"init 缺省 params 应仅 url: {main.requests[-1]!r}")

        # 非 2xx=in-band 成功
        res = fetch(cap, "https://ok.example.com/notfound")
        if res["status"] != 404 or res["body"] != "nope":
            problems.append(f"404 in-band 映射不符: {res!r}")

        # 连接复用：两次 fetch 单连接＋id 单调递增
        base_conn = main.connections
        fetch(cap, "https://ok.example.com/api")
        fetch(cap, "https://ok.example.com/notfound")
        if main.connections != base_conn:
            problems.append(f"连接应复用（未新开），实际 connections={main.connections}")
        ids = [r["id"] for r in main.requests[-2:]]
        if ids != [ids[0], ids[0] + 1]:
            problems.append(f"id 应连接内单调递增: {ids!r}")

        # status===0 → NET-FAILED（message=宿主 statusText）
        expect_net_error(cap.fetch("https://dead.example.com/unreachable"), "NET-FAILED", "网络失败: getaddrinfo")

        # 白名单外 → NET-DENIED（可判别＋宿主文案）
        expect_net_error(cap.fetch("https://evil.example.net/exfil"), "NET-DENIED", "域名白名单外默认拒绝")
        expect_net_error(cap.fetch("https://unknown.example.org/x"), "NET-DENIED")

        # 错误类名（帧 name 同构判据）
        try:
            asyncio.run(cap.fetch("https://evil.example.net/exfil"))
        except SdkNetError as e:
            if type(e).__name__ != "SdkNetError":
                problems.append(f"错误帧 name 应为 SdkNetError: {type(e).__name__}")

        # close() 后 fetch → BRIDGE-CLOSED 不再重连
        cap.close()
        expect_net_error(cap.fetch("https://ok.example.com/api"), "BRIDGE-CLOSED", "net 客户端已关闭")
    finally:
        main.stop()

    # 连接失败（端点不开）→ BRIDGE-CLOSED
    cap = make_net_cap("ws://127.0.0.1:1")
    expect_net_error(cap.fetch("https://ok.example.com/api"), "BRIDGE-CLOSED", "net 桥连接失败")
    cap.close()

    # 服务端不应答 → BRIDGE-TIMEOUT（逐请求计时）
    silent = MiniNetServer(mode="silent")
    silent.start()
    try:
        cap = make_net_cap(silent.url, fetch_timeout_ms=300)
        expect_net_error(cap.fetch("https://ok.example.com/api"), "BRIDGE-TIMEOUT", ">300ms")
        cap.close()
    finally:
        silent.stop()

    # 应答前服务端断连 → BRIDGE-CLOSED
    killer = MiniNetServer(mode="close-on-message")
    killer.start()
    try:
        cap = make_net_cap(killer.url)
        expect_net_error(cap.fetch("https://ok.example.com/api"), "BRIDGE-CLOSED")
        cap.close()
    finally:
        killer.stop()

    # 服务端应答后断连 → 后续 fetch 懒重连成功（新连接；id 连接内单调递增）
    chatty = MiniNetServer(
        mode="close-after-reply",
        replies={
            "https://ok.example.com/api": {"ok": True, "result": {"status": 200, "statusText": "OK", "headers": {}, "bodyB64": b64("round1")}},
            "https://ok.example.com/api2": {"ok": True, "result": {"status": 200, "statusText": "OK", "headers": {}, "bodyB64": b64("round2")}},
        },
    )
    chatty.start()
    try:
        cap = make_net_cap(chatty.url)
        if fetch(cap, "https://ok.example.com/api")["body"] != "round1":
            problems.append("close-after-reply 首轮 body 不符")
        if fetch(cap, "https://ok.example.com/api2")["body"] != "round2":
            problems.append("懒重连第二轮 body 不符")
        if chatty.connections != 2:
            problems.append(f"重连应开第二连接，实际 {chatty.connections}")
        # id 序=[1,3]：fetch#2 首尝试（id=2）落在陈旧连接上未达服务端——丢弃重试吸收后以
        # id=3 新连接成功（各连接内仍单调递增，满足 T0-07 客户端义务；ts 侧 readyState
        # 规避陈旧发送故无烧号——见 net-cap.test.ts 同用例 [1,2] 注）
        if [r["id"] for r in chatty.requests] != [1, 3]:
            problems.append(f"id 连接内单调递增（陈旧连接烧号+重连续号）: {[r['id'] for r in chatty.requests]!r}")
        cap.close()
    finally:
        chatty.stop()

    return problems


# ————————————————————————————————————————————
# ② 子进程 bootstrap 装配面（三态②bound／③NET-DENIED 内嵌／①unbound）
# ————————————————————————————————————————————

SHIM = "import os, sys\nsys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))\n"

BOUND_ENTRY = (
    SHIM
    + "from constella_sdk.bootstrap import boot\n"
    + "\n"
    + "async def run(ctx):\n"
    + "    res = await ctx.net.fetch('https://ok.example.com/api')\n"
    + "    denied = None\n"
    + "    try:\n"
    + "        await ctx.net.fetch('https://evil.example.net/exfil')\n"
    + "    except Exception as e:\n"
    + "        denied = getattr(e, 'code', None)\n"
    + "    return {'data': {'status': res['status'], 'statusText': res['statusText'], 'body': res['body'], 'denied': denied}}\n"
    + "\n"
    + "boot(run)\n"
)

UNBOUND_ENTRY = (
    SHIM
    + "from constella_sdk.bootstrap import boot\n"
    + "\n"
    + "async def run(ctx):\n"
    + "    await ctx.net.fetch('https://ok.example.com/api')  # 无 CONSTELLA_NET_WS——三态①unbound\n"
    + "    return {'data': 'unreachable'}\n"
    + "\n"
    + "boot(run)\n"
)

# 内联期望=ts contract.test.ts「caps net 绑定三态」段同文（ts/py 同构判据面）
BOUND_EXPECTED = {
    "id": "net-bound",
    "exit": 0,
    "frames": [{"type": "result", "out": {"data": {"status": 200, "statusText": "OK", "body": OK_BODY, "denied": "NET-DENIED"}}}],
}
UNBOUND_EXPECTED = {
    "id": "net-unbound",
    "exit": 1,
    "frames": [{
        "type": "error",
        "name": "SdkCapUnavailableError",
        "message": "SDK_CAP_UNAVAILABLE:net.fetch（能力未绑定；运行时绑定注入见 02 §14/§12.1）",
        "code": "SDK_CAP_UNAVAILABLE",
    }],
}


def child_env(net_ws: str | None) -> dict[str, str]:
    env = {
        "PATH": os.environ.get("PATH", ""),
        "SYSTEMROOT": os.environ.get("SYSTEMROOT", ""),
        "TEMP": os.environ.get("TEMP", ""),
        "CONSTELLA_RUN_ID": "sdk-net-py",
        "CONSTELLA_CTX": json.dumps({"params": {}, "input": None}, ensure_ascii=False),
    }
    if net_ws is not None:
        env["CONSTELLA_NET_WS"] = net_ws
    return env


def run_child(entry: Path, env: dict[str, str]) -> tuple[int | None, str, str, bool]:
    proc = subprocess.Popen(
        [sys.executable, "-I", "-X", "utf8", str(entry)],
        cwd=str(PY_ROOT.parent),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
    )
    try:
        out_b, err_b = proc.communicate(timeout=CHILD_TIMEOUT_S)
        timed_out = False
    except subprocess.TimeoutExpired:
        subprocess.run(
            ["taskkill", "/PID", str(proc.pid), "/T", "/F"],
            capture_output=True,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
        out_b, err_b = proc.communicate()
        timed_out = True
    return proc.returncode, out_b.decode("utf-8", "replace"), err_b.decode("utf-8", "replace"), timed_out


def child_problems(server_url: str) -> list[str]:
    problems: list[str] = []
    if SANDBOX.parent.exists():
        shutil.rmtree(SANDBOX.parent, ignore_errors=True)
    SANDBOX.mkdir(parents=True)
    shutil.copytree(PKG_SRC, SANDBOX / "constella_sdk", ignore=shutil.ignore_patterns("__pycache__"))
    (SANDBOX / "net-bound.entry.py").write_text(BOUND_ENTRY, encoding="utf-8")
    (SANDBOX / "net-unbound.entry.py").write_text(UNBOUND_ENTRY, encoding="utf-8")
    try:
        cases = [
            ("net-bound", BOUND_EXPECTED, child_env(server_url)),
            ("net-unbound", UNBOUND_EXPECTED, child_env(None)),
        ]
        for label, expected, env in cases:
            code, stdout, stderr, timed_out = run_child(SANDBOX / f"{label}.entry.py", env)
            frames = []
            unparseable = []
            for line in stdout.splitlines():
                if line.strip() == "":
                    continue
                try:
                    frames.append(json.loads(line))
                except ValueError:
                    unparseable.append(line)
            if unparseable:
                problems.append(f"{label}: stdout 存在非 JSON 行 {unparseable!r}")
            if stderr != "":
                problems.append(f"{label}: stderr 不承载协议，实际 {stderr[:200]!r}")
            if timed_out:
                problems.append(f"{label}: 子进程超时（>{CHILD_TIMEOUT_S}s）")
            stripped = []
            for f in frames:
                copy = dict(f)
                copy.pop("runtime", None)
                copy.pop("stack", None)
                stripped.append(copy)
            terminals = [f for f in frames if f.get("type") in ("result", "error")]
            if len(terminals) != 1 or frames[-1] is not terminals[0]:
                problems.append(f"{label}: 终帧应恰一且为末行，实际 {len(terminals)} 帧")
            if code != expected["exit"]:
                problems.append(f"{label}: exit {code} != 期望 {expected['exit']}")
            if stripped != expected["frames"]:
                problems.append(f"{label}: 帧序列不符:\n    期望 {expected['frames']!r}\n    实际 {stripped!r}")
    finally:
        shutil.rmtree(SANDBOX.parent, ignore_errors=True)
    return problems


# ————————————————————————————————————————————
# 套件入口
# ————————————————————————————————————————————

def main() -> int:
    import constella_sdk  # noqa: F401 —— 导入面冒烟（含 net 新面）

    print(f"constella_sdk py net 绑定验收（T5-12b）——解释器: {sys.executable}")
    results: list[tuple[str, list[str]]] = [("caps-inprocess", inprocess_problems())]
    child_server = MiniNetServer(replies=main_replies())
    child_server.start()
    try:
        results.append(("caps-bootstrap-child", child_problems(child_server.url)))
    finally:
        child_server.stop()
    failed = False
    for label, problems in results:
        print(f"{'PASS' if not problems else 'FAIL'} {label}" + ("" if not problems else f" —— {'；'.join(problems)}"))
        failed = failed or bool(problems)
    print("全部通过" if not failed else "存在失败")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
