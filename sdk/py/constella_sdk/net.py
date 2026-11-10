# constella_sdk.net —— ctx.net 绑定客户端（T5-12b；ts 对照物 sdk/src/net.ts）。
#
# K-01 §2 冻结径②（03 §3 caps 行）：py 侧=包内置极简 RFC6455 文本帧客户端，stdlib 零三方
# ——握手（Sec-WebSocket-Key/Accept）/客户端帧必掩码（RFC6455 §5.3）/文本帧收发；
# 不发 Sec-WebSocket-Extensions 扩展头（桥服务端禁 permessage-deflate 前提，T0-06 会签）。
#
# 线形=T5-12a PM 缺省③共享契约（T0-07 统一帧形的同构复制——K-01 §2 红线：不 import
# X-01 shared ipc 域，shared/src/ipc/bridge.ts 为同源权威）：
#   请求（文本帧 JSON） {"id":number,"ns":"net","method":"fetch","params":{"url","headers"?}}
#   → 成功 {"id",ok:true,result:{status,statusText,headers,bodyB64}}
#   ｜失败 {"id",ok:false,error:{code,message}}
#   - id 连接内单调递增=客户端义务（T0-07）；
#   - status===0＝网络层失败（宿主 net-proxy-bridge.ts 冻结语义）→ 抛 SdkNetError
#     {code:'NET-FAILED', message=statusText}；非 2xx=in-band 成功（status 真值原样返回）；
#   - 白名单拒 {code:'NET-DENIED'} → 抛 SdkNetError（code 可判别，message=宿主文案）。
# 错误码值复制（同源 shared/src/ipc/bridge.ts BRIDGE_ERROR_CODES——K-01 §2 红线不 import）：
#   请求超时='BRIDGE-TIMEOUT'；连接失败/应答前关闭='BRIDGE-CLOSED'。
#
# 连接策略（与 ts 同构语义）：懒连接（首次 fetch 才握手）＋连接复用（同端点单连接跨 fetch
# 复用；fetch 间以线程锁串行——send/收帧配对极简径，锁内等应答）；断连/超时=丢弃连接、
# 下次 fetch 重连。陈旧连接（服务端已关、py 侧迟至 I/O 才暴露）在复用连接传输失败时以
# 新连接重试一次吸收（ts 侧同场景由 readyState 判定规避）。超时为逐请求（socket timeout，
# 缺省 30s）。
# 阻塞 socket I/O 经 asyncio.to_thread 出事件循环（sleep/emit 在 fetch 期间仍可响应）。
from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import os
import socket
import threading
from typing import Any
from urllib.parse import urlsplit

from .caps import NetFetchResponse

__all__ = ["DEFAULT_NET_FETCH_TIMEOUT_MS", "SdkNetError", "make_net_cap"]

_WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"  # RFC6455 §1.3

#: 缺省单请求超时（ms）——BRIDGE-TIMEOUT 语义（码值同源 shared BRIDGE_ERROR_CODES.BRIDGE_TIMEOUT）
DEFAULT_NET_FETCH_TIMEOUT_MS = 30_000

# 错误码常量（值复制自 shared/src/ipc/bridge.ts BRIDGE_ERROR_CODES——K-01 §2 红线不 import）
_CODE_BRIDGE_TIMEOUT = "BRIDGE-TIMEOUT"
_CODE_BRIDGE_CLOSED = "BRIDGE-CLOSED"


class SdkNetError(Exception):
    """net 能力错误（帧 name=SdkNetError，code 判别；ts 对照物 sdk/src/net.ts 同构）。

    'NET-FAILED'=网络层失败（宿主 status===0）；'NET-DENIED'=域名白名单拒（可判别）；
    'BRIDGE-TIMEOUT'/'BRIDGE-CLOSED'=传输层（超时/连接失败/应答前关闭）；
    其余=宿主错误帧原样透传（code/message）。
    """

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


# ————————————————————————————————————————————
# RFC6455 极简帧面（客户端子集：文本帧/close/ping-pong；服务端帧不掩码）
# ————————————————————————————————————————————

def _mask(data: bytes, mask: bytes) -> bytes:
    """RFC6455 §5.3 掩码：octet[i] ^= mask[i mod 4]（整数字异或实现，避免逐字节循环）。"""
    n = len(data)
    if n == 0:
        return b""
    repeated = (mask * (n // 4 + 1))[:n]
    return (int.from_bytes(data, "big") ^ int.from_bytes(repeated, "big")).to_bytes(n, "big")


def _send_frame(sock: socket.socket, payload: bytes, opcode: int = 0x1) -> None:
    """发送客户端帧（FIN+opcode；必掩码——RFC6455 客户端义务）。"""
    mask_key = os.urandom(4)
    n = len(payload)
    head = bytearray([0x80 | opcode])
    if n < 126:
        head.append(0x80 | n)
    elif n < 65536:
        head.append(0x80 | 126)
        head += n.to_bytes(2, "big")
    else:
        head.append(0x80 | 127)
        head += n.to_bytes(8, "big")
    head += mask_key
    sock.sendall(bytes(head) + _mask(payload, mask_key))


class _RecvBuffer:
    """收取缓冲（握手残余+recv 拼接；按需精确读取 n 字节）。"""

    __slots__ = ("_sock", "_buf")

    def __init__(self, sock: socket.socket, initial: bytes = b"") -> None:
        self._sock = sock
        self._buf = initial

    def read_exact(self, n: int) -> bytes:
        while len(self._buf) < n:
            chunk = self._sock.recv(65536)
            if not chunk:
                raise SdkNetError(_CODE_BRIDGE_CLOSED, "net 桥连接中断")
            self._buf += chunk
        out, self._buf = self._buf[:n], self._buf[n:]
        return out


def _recv_message(reader: _RecvBuffer, sock: socket.socket) -> str:
    """收取一条完整文本消息（分片聚帧至 FIN）；ping→pong 应答；close→BRIDGE-CLOSED。"""
    message = b""
    message_opcode = -1
    for _ in range(16):  # 分片上限（协议面防呆——桥帧均为小单帧）
        b1 = reader.read_exact(1)[0]
        fin = (b1 & 0x80) != 0
        opcode = b1 & 0x0F
        b2 = reader.read_exact(1)[0]
        if (b2 & 0x80) != 0:
            raise SdkNetError(_CODE_BRIDGE_CLOSED, "net 桥服务端帧不得掩码（RFC6455 §5.1）")
        length = b2 & 0x7F
        if length == 126:
            length = int.from_bytes(reader.read_exact(2), "big")
        elif length == 127:
            length = int.from_bytes(reader.read_exact(8), "big")
        payload = reader.read_exact(length)
        if opcode == 0x8:  # close——镜像 close 后抬 BRIDGE-CLOSED
            try:
                _send_frame(sock, b"", opcode=0x8)
            except OSError:
                pass
            raise SdkNetError(_CODE_BRIDGE_CLOSED, "net 桥发送 close 帧")
        if opcode == 0x9:  # ping→pong（同载荷）
            _send_frame(sock, payload, opcode=0xA)
            continue
        if opcode == 0xA:  # pong（本客户端不发 ping）——忽略
            continue
        if opcode in (0x1, 0x2):
            message_opcode = opcode
            message = payload
        elif opcode == 0x0 and message_opcode != -1:
            message += payload  # continuation 分片
        else:
            continue  # 协议外帧——丢弃
        if fin:
            return message.decode("utf-8", "replace")
    raise SdkNetError(_CODE_BRIDGE_CLOSED, "net 桥分片超限")


def _handshake(sock: socket.socket, host_header: str, path: str) -> bytes:
    """RFC6455 握手（§4.1）；返回 HTTP 头后残余字节（服务端无推送帧——协议上应为空）。"""
    key = base64.b64encode(os.urandom(16)).decode("ascii")
    request = (
        f"GET {path} HTTP/1.1\r\n"
        f"Host: {host_header}\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {key}\r\n"
        "Sec-WebSocket-Version: 13\r\n"
        "\r\n"
    )
    # 不发 Sec-WebSocket-Extensions——禁 deflate 前提（T0-06 会签；K-01 §2 冻结径）
    sock.sendall(request.encode("ascii"))
    buf = bytearray()
    while b"\r\n\r\n" not in buf:
        chunk = sock.recv(4096)
        if not chunk:
            raise SdkNetError(_CODE_BRIDGE_CLOSED, "net 桥握手连接中断")
        buf += chunk
        if len(buf) > 8192:
            raise SdkNetError(_CODE_BRIDGE_CLOSED, "net 桥握手响应超限")
    head, _, leftover = bytes(buf).partition(b"\r\n\r\n")
    status_line = head.split(b"\r\n", 1)[0].decode("latin-1")
    status_parts = status_line.split(" ")
    if len(status_parts) < 2 or status_parts[1] != "101":
        raise SdkNetError(_CODE_BRIDGE_CLOSED, f"net 桥握手失败: {status_line}")
    accept_expect = base64.b64encode(hashlib.sha1((key + _WS_GUID).encode("ascii")).digest()).decode("ascii")
    headers = {}
    for line in head.split(b"\r\n")[1:]:
        name, _, value = line.partition(b":")
        headers[name.strip().lower().decode("latin-1")] = value.strip().decode("latin-1")
    if headers.get("sec-websocket-accept") != accept_expect:
        raise SdkNetError(_CODE_BRIDGE_CLOSED, "net 桥握手 Sec-WebSocket-Accept 校验失败")
    return leftover


# ————————————————————————————————————————————
# 客户端本体
# ————————————————————————————————————————————

class _NetCapClient:
    """ctx.net 绑定客户端（bootstrap 按 CONSTELLA_NET_WS 在场装配）。"""

    def __init__(self, endpoint: str, fetch_timeout_ms: int = DEFAULT_NET_FETCH_TIMEOUT_MS) -> None:
        split = urlsplit(endpoint)
        if split.scheme != "ws" or not split.hostname:
            raise SdkNetError(_CODE_BRIDGE_CLOSED, f"net 桥端点形非法（期望 ws://host:port）: {endpoint}")
        port = split.port if split.port is not None else 80
        path = split.path or "/"
        if split.query:
            path += "?" + split.query
        self._addr = (split.hostname, port)
        self._path = path
        self._host_header = f"{split.hostname}:{port}"
        self._timeout_ms = fetch_timeout_ms
        self._lock = threading.Lock()  # fetch 串行（send/收帧配对极简径）
        self._sock: socket.socket | None = None
        self._reader: _RecvBuffer | None = None
        self._next_id = 1
        self._closed = False

    async def fetch(self, url: str, init: dict[str, dict[str, str]] | None = None) -> NetFetchResponse:
        """阻塞 ws 往返经 to_thread 出事件循环（fetch 期间 sleep/emit 仍可响应）。"""
        return await asyncio.to_thread(self._fetch_sync, url, init)

    def close(self) -> None:
        """显式关闭（测试/收尾面；进程退出面由 OS 回收 fd）。关闭后 fetch 拒 BRIDGE-CLOSED 不再重连。"""
        with self._lock:
            self._closed = True
            self._drop()

    # ——— 内部（锁内同步面）———

    def _fetch_sync(self, url: str, init: dict[str, dict[str, str]] | None) -> NetFetchResponse:
        # 陈旧连接吸收：复用中的连接可能已被服务端关闭（py 无 readyState 事件面——迟至
        # 下次 I/O 才暴露；ts 侧由 readyState 判定规避）——复用连接上的传输失败丢弃后以
        # 新连接重试一次；新连接上的失败直抛（真连接故障）。
        last_err: SdkNetError | None = None
        for attempt in range(2):
            with self._lock:
                if self._closed:
                    raise SdkNetError(_CODE_BRIDGE_CLOSED, "net 客户端已关闭")
                reused = self._sock is not None
                params: dict[str, Any] = {"url": url}
                headers = (init or {}).get("headers")
                if headers:
                    params["headers"] = dict(headers)
                frame_id = self._next_id
                self._next_id += 1  # id 连接内单调递增（T0-07 客户端义务）
                payload = json.dumps(
                    {"id": frame_id, "ns": "net", "method": "fetch", "params": params},
                    ensure_ascii=False,
                    separators=(",", ":"),
                ).encode("utf-8")
                try:
                    self._ensure_open()
                    assert self._sock is not None and self._reader is not None  # ensure_open 后置条件
                    _send_frame(self._sock, payload)
                    reply = self._await_reply(frame_id)
                except TimeoutError:  # py3.10+ socket.timeout 即 TimeoutError（OSError 子类——先于 OSError 捕）
                    self._drop()
                    raise SdkNetError(
                        _CODE_BRIDGE_TIMEOUT, f"net 桥请求超时（>{self._timeout_ms}ms）: {url}"
                    ) from None
                except (SdkNetError, OSError) as e:
                    self._drop()
                    if not isinstance(e, SdkNetError):
                        e = SdkNetError(_CODE_BRIDGE_CLOSED, f"net 桥连接失败: {e}")
                    if reused and attempt == 0:
                        last_err = e
                        continue  # 陈旧连接吸收——新连接重试一次
                    raise e
                return _map_reply(reply)  # in-band 映射（NET-FAILED/NET-DENIED 不动连接）
        raise last_err if last_err is not None else SdkNetError(_CODE_BRIDGE_CLOSED, "net 桥请求失败")

    def _ensure_open(self) -> None:
        if self._sock is not None:
            return
        try:
            sock = socket.create_connection(self._addr, timeout=self._timeout_ms / 1000)
        except OSError as e:
            raise SdkNetError(_CODE_BRIDGE_CLOSED, f"net 桥连接失败: {e}") from None
        try:
            sock.settimeout(self._timeout_ms / 1000)
            leftover = _handshake(sock, self._host_header, self._path)
        except BaseException:
            sock.close()
            raise
        self._sock = sock
        self._reader = _RecvBuffer(sock, leftover)

    def _await_reply(self, frame_id: int) -> dict[str, Any]:
        assert self._sock is not None and self._reader is not None  # noqa: S101 —— 锁内前置已保
        while True:
            try:
                data = json.loads(_recv_message(self._reader, self._sock))
            except ValueError:
                raise SdkNetError(_CODE_BRIDGE_CLOSED, "net 桥回帧非 JSON") from None
            if not isinstance(data, dict):
                raise SdkNetError(_CODE_BRIDGE_CLOSED, "net 桥回帧形异常")
            if data.get("id") == frame_id:
                return data
            # 串行径不应收到他 id——容忍续等（超时兜底）

    def _drop(self) -> None:
        if self._sock is not None:
            try:
                self._sock.close()
            except OSError:
                pass
        self._sock = None
        self._reader = None


def _map_reply(reply: dict[str, Any]) -> NetFetchResponse:
    """ok result → NetFetchResponse（bodyB64→utf8 文本，非法序列替换字符）；错误帧→SdkNetError。"""
    if reply.get("ok") is True:
        result = reply.get("result")
        if not isinstance(result, dict) or not isinstance(result.get("status"), int):
            raise SdkNetError(_CODE_BRIDGE_CLOSED, "net 桥回帧 result 形异常")
        if result["status"] == 0:
            # status===0＝网络层失败（宿主冻结语义）——statusText 即宿主网络失败描述
            raise SdkNetError("NET-FAILED", str(result.get("statusText", "")))
        body_b64 = result.get("bodyB64")
        body = base64.b64decode(body_b64).decode("utf-8", "replace") if isinstance(body_b64, str) and body_b64 else ""
        raw_headers = result.get("headers")
        headers = {str(k): str(v) for k, v in raw_headers.items()} if isinstance(raw_headers, dict) else {}
        return {
            "status": result["status"],
            "statusText": str(result.get("statusText", "")),
            "headers": headers,
            "body": body,
        }
    error = reply.get("error")
    if isinstance(error, dict):
        # NET-DENIED 等宿主码原样透传（可判别）
        raise SdkNetError(str(error.get("code", "")), str(error.get("message", "")))
    raise SdkNetError(_CODE_BRIDGE_CLOSED, "net 桥回帧形异常")


def make_net_cap(endpoint: str, fetch_timeout_ms: int = DEFAULT_NET_FETCH_TIMEOUT_MS) -> _NetCapClient:
    """net 绑定 cap 工厂：bootstrap 按 CONSTELLA_NET_WS 在场调用（缺场=unbound_cap 三态不变）。"""
    return _NetCapClient(endpoint, fetch_timeout_ms)
