# TDD-K-01 §1 py 侧契约验收（T4-11）——判据=帧形冻结段；驱动方式自拟（参照 ts 侧
# sdk/test/contract.test.ts）：沙箱置包＋生成 entry，spawn `python -I -X utf8 <entry>`
# 子进程，经 CONSTELLA_CTX 注入 ctx、采集 stdout JSON 行帧与 exit 码，对拍共享期望
# 资产 sdk/fixtures/expected/*.json（ts/py 双运行时同一套，只读复用）。
#
# 场景集（12）：
#   六形态（期望 JSON 驱动）＋装配错误三态（CTX_MISSING/CTX_INVALID_JSON/ENTRY_NO_RUN，
#   内联期望=ts 测试同文）＋caps 未绑定两态（子进程访问＋进程内七 Cap 探针）＋
#   沙箱 sys.path[0] 可达探针（S-4／K-01 §1 指定 M5 施工核对——包目录与 entry 同置）。
#
# ⚠ 核对结论（T4-11 实证，Python 3.12.10=S-4 锁定版）：「-I 下经 sys.path[0] 可达」
# 前提不成立——Python 3.11 起 `-I` 隐含 `-P`（safe path，python -h："-I ... implies
# -E, -P and -s"），脚本目录不入 sys.path，沙箱内 import constella_sdk 直接
# ModuleNotFoundError；PYTHON* 通道被 -E 忽略且卡面禁止，无零偏差解。处置=spawn 形参
# `python -I -X utf8 <entry>`（S-4 冻结不变）不动，宿主生成 entry 在冻结两行之前加
# sys.path 前置垫片（见 SHIM）——已上报协调者，03 §1 py 段该句待勘误。
#
# 对照规则（与 ts 侧同口径）：
#   - result 终帧剥 runtime、error 终帧剥 stack 后逐帧深相等（帧形冻结=多字段/少字段均失败）；
#   - 终帧恰一且为末行、stdout 全行可解析为 JSON、stderr 不承载协议（应空，S-5①）；
#   - exit 0/1/2 逐场景断言（S-5②）。
#
# 运行：`py -I -X utf8 sdk/py/tests/run_contract.py`（Windows PATH 上 `python` 为
# WindowsApps store stub；py 启动器解析唯一注册 3.12.10=S-4 锁定版）。
# allow: SIZE_OK —— 12 场景契约验收判据集合（含内联期望帧表≈40 行数据）；验收命令冻结
# 单文件入口，且 -I 下脚本目录不入 sys.path、拆分兄弟模块需自带垫片，拆分得不偿失。
from __future__ import annotations

import json
import os
import platform
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

PY_ROOT = Path(__file__).resolve().parent.parent  # sdk/py
SDK_ROOT = PY_ROOT.parent  # sdk/
EXPECTED_DIR = SDK_ROOT / "fixtures" / "expected"
PKG_SRC = PY_ROOT / "constella_sdk"
FIXTURES_SRC = PY_ROOT / "fixtures"
SANDBOX = PY_ROOT / ".tmp" / "contract" / "sandbox"
CHILD_TIMEOUT_S = 15.0
TERMINAL_TYPES = ("result", "error")

Expected = dict[str, Any]  # {id, ctx, exit, frames}——期望资产形（测试内联同形）


# ---------- 期望资产（fixtures/expected/*.json —— 六形态冻结契约，只读） ----------
def load_expected() -> list[Expected]:
    files = sorted(p for p in EXPECTED_DIR.iterdir() if p.suffix == ".json")
    assert len(files) == 6, f"期望资产恰六份（S-5 六形态），实际 {len(files)}"
    out: list[Expected] = []
    for p in files:
        e = json.loads(p.read_text(encoding="utf-8"))
        assert e["id"] == p.stem, f"期望 id 应与文件名一致：{p.name}"
        out.append(e)
    return out


# ---------- 子进程驱动（spawn 形参 `python -I -X utf8 <entry>`，S-4 冻结） ----------
@dataclass(frozen=True, slots=True)
class ChildResult:
    code: int | None
    stdout: str
    stderr: str
    timed_out: bool


def run_child(entry: Path, env: dict[str, str]) -> ChildResult:
    proc = subprocess.Popen(
        [sys.executable, "-I", "-X", "utf8", str(entry)],
        cwd=SDK_ROOT,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
    )
    try:
        out_b, err_b = proc.communicate(timeout=CHILD_TIMEOUT_S)
        timed_out = False
    except subprocess.TimeoutExpired:
        # S-4 结论：taskkill /PID <pid> /T /F 真树杀；child.kill() 只杀直接子进程不可用
        subprocess.run(
            ["taskkill", "/PID", str(proc.pid), "/T", "/F"],
            capture_output=True,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
        out_b, err_b = proc.communicate()
        timed_out = True
    return ChildResult(
        proc.returncode,
        out_b.decode("utf-8", "replace"),
        err_b.decode("utf-8", "replace"),
        timed_out,
    )


def base_env() -> dict[str, str]:
    """§12.1 env 白名单（S-5⑧ 实测；py 子进程无 ELECTRON_RUN_AS_NODE 项）。"""
    return {
        "PATH": os.environ.get("PATH", ""),
        "SYSTEMROOT": os.environ.get("SYSTEMROOT", ""),
        "TEMP": os.environ.get("TEMP", ""),
        "CONSTELLA_RUN_ID": "sdk-contract-py",
    }


def env_with_ctx(ctx: object = None, raw: str | None = None) -> dict[str, str]:
    env = base_env()
    env["CONSTELLA_CTX"] = raw if raw is not None else json.dumps(ctx, ensure_ascii=False)
    return env


# ---------- 帧解析与对照（与 ts 侧 stripVolatile/assertContract 同口径） ----------
def parse_frames(stdout: str) -> tuple[list[dict[str, Any]], list[str]]:
    frames: list[dict[str, Any]] = []
    unparseable: list[str] = []
    for line in stdout.splitlines():
        if line.strip() == "":
            continue
        try:
            f = json.loads(line)
        except ValueError:
            unparseable.append(line)
            continue
        if isinstance(f, dict):
            frames.append(f)
        else:
            unparseable.append(line)
    return frames, unparseable


def strip_volatile(frame: dict[str, Any]) -> dict[str, Any]:
    copy = dict(frame)
    if copy.get("type") == "result":
        copy.pop("runtime", None)
    if copy.get("type") == "error":
        copy.pop("stack", None)
    return copy


def check_contract(label: str, expected: Expected, res: ChildResult) -> str | None:
    """返回 None=通过；str=失败描述（帧形冻结=多字段/少字段/帧序/exit 任一不符均失败）。"""
    frames, unparseable = parse_frames(res.stdout)
    problems: list[str] = []
    if unparseable:
        problems.append(f"stdout 存在不可解析为 JSON 的行: {unparseable!r}")
    if res.stderr != "":
        problems.append(f"stderr 不承载协议、应为空，实际: {res.stderr[:200]!r}")
    if res.timed_out:
        problems.append(f"子进程超时（>{CHILD_TIMEOUT_S}s，已 taskkill /T /F）")
    terminal_idx = [i for i, f in enumerate(frames) if f.get("type") in TERMINAL_TYPES]
    if len(terminal_idx) != 1:
        problems.append(f"终帧（result|error）应恰一，实际 {len(terminal_idx)} 帧")
    elif terminal_idx[0] != len(frames) - 1:
        problems.append("终帧应为末行")
    if res.code != expected["exit"]:
        problems.append(f"exit 码 {res.code} != 期望 {expected['exit']}（0=成功/1=脚本错误/2=装配错误）")
    stripped = [strip_volatile(f) for f in frames]
    if stripped != expected["frames"]:
        problems.append(f"帧序列剥 runtime/stack 后与期望不一致:\n    期望: {expected['frames']!r}\n    实际: {stripped!r}")
    if frames and frames[-1].get("type") == "result":
        rt = frames[-1].get("runtime")
        rt_keys = sorted(rt) if isinstance(rt, dict) else None
        if rt_keys != ["electron", "execPath", "node", "sdkVersion"]:
            problems.append(f"runtime 字段集应为 {{node,electron,execPath,sdkVersion}}，实际 {rt_keys!r}")
        elif (
            rt["node"] != platform.python_version()
            or rt["electron"] is not None
            or rt["execPath"] != sys.executable
            or rt["sdkVersion"] != _sdk().__version__
        ):
            problems.append(f"runtime 值异常: {rt!r}")
    return "；".join(problems) if problems else None


# ---------- 沙箱置包＋entry 生成（包目录与 entry 同置沙箱脚本目录） ----------
# entry=冻结薄脚本形态（from constella_sdk.bootstrap import boot; boot(entry_mod.run)）
# ＋SHIM 前置垫片（-I⇒-P 使脚本目录不入 sys.path 的实证处置，见文件头 ⚠ 注记）。
SHIM = (
    "import os, sys\n"
    "sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))\n"
)


def entry_source(fixture_id: str) -> str:
    module = fixture_id.replace("-", "_")
    return (
        SHIM
        + "from constella_sdk.bootstrap import boot\n"
        f"import {module} as entry_mod\n"
        "boot(entry_mod.run)\n"
    )


def build_sandbox(expected: list[Expected]) -> None:
    tmp_root = SANDBOX.parent
    if tmp_root.exists():
        shutil.rmtree(tmp_root)
    SANDBOX.mkdir(parents=True)
    shutil.copytree(PKG_SRC, SANDBOX / "constella_sdk", ignore=shutil.ignore_patterns("__pycache__"))
    for src in FIXTURES_SRC.iterdir():
        if src.is_dir():
            shutil.copytree(src, SANDBOX / src.name)
        elif src.suffix == ".py":
            shutil.copy2(src, SANDBOX / src.name)
    for e in expected:
        (SANDBOX / f"{e['id']}.entry.py").write_text(entry_source(e["id"]), encoding="utf-8")
    (SANDBOX / "boot-entry-no-run.entry.py").write_text(
        SHIM
        + "from constella_sdk.bootstrap import boot\n"
        "import s1_basic as entry_mod\n"
        "boot(getattr(entry_mod, 'not_run', None))  # 未导出 run —— ENTRY_NO_RUN 装配错误形态\n",
        encoding="utf-8",
    )
    (SANDBOX / "cap-access.entry.py").write_text(
        SHIM
        + "from constella_sdk.bootstrap import boot\n"
        "\n"
        "async def run(ctx):\n"
        "    await ctx.llm.json('hi')  # 未绑定能力访问 —— SDK_CAP_UNAVAILABLE 形态\n"
        "    return {'data': 'unreachable'}\n"
        "\n"
        "boot(run)\n",
        encoding="utf-8",
    )
    (SANDBOX / "syspath-probe.entry.py").write_text(
        SHIM
        + "import json\n"
        "import constella_sdk\n"
        "import sys\n"
        "print(json.dumps({'type': 'probe', 'path0': sys.path[0], 'version': constella_sdk.__version__}, ensure_ascii=False))\n",
        encoding="utf-8",
    )


# ---------- 进程内 constella_sdk（运行时值断言＋caps 探针；-I 下经 sys.path 注入本进程） ----------
_SDK: Any = None


def _sdk() -> Any:
    global _SDK
    if _SDK is None:
        sys.dont_write_bytecode = True
        sys.path.insert(0, str(PY_ROOT))
        import constella_sdk

        _SDK = constella_sdk
    return _SDK


def caps_inprocess_problems() -> str | None:
    try:
        sdk = _sdk()
    except ImportError as e:
        return f"constella_sdk 不可导入: {e}"
    probes = [
        ("browser", "open"),
        ("llm", "json"),
        ("net", "fetch"),
        ("file", "read"),
        ("im", "pollUnread"),
        ("vault", "exec"),
        ("agent", "reply"),
    ]
    problems: list[str] = []
    for cap, member in probes:
        stub = sdk.unbound_cap(cap)
        try:
            getattr(stub, member)()
        except sdk.SdkCapUnavailableError as e:
            if e.code != "SDK_CAP_UNAVAILABLE" or f"{cap}.{member}" not in str(e):
                problems.append(f"ctx.{cap}.{member} 错误帧字段异常: code={e.code!r} msg={str(e)!r}")
        except BaseException as e:  # noqa: BLE001 —— 探针需捕获一切非契约异常并落为失败描述
            problems.append(f"ctx.{cap}.{member} 应抛 SdkCapUnavailableError，实际 {type(e).__name__}: {e}")
        else:
            problems.append(f"ctx.{cap}.{member} 访问未抛错")
    return "；".join(problems) if problems else None


def syspath_probe_problems() -> str | None:
    if not (SANDBOX / "constella_sdk" / "py.typed").is_file():
        return "沙箱包目录缺 py.typed（PEP 561 标记应随包目录同置）"
    res = run_child(SANDBOX / "syspath-probe.entry.py", base_env())
    problems: list[str] = []
    if res.code != 0 or res.stderr != "" or res.timed_out:
        problems.append(f"-I 子进程应正常退出: code={res.code} stderr={res.stderr[:200]!r} timedOut={res.timed_out}")
    frames, unparseable = parse_frames(res.stdout)
    if unparseable or len(frames) != 1 or frames[0].get("type") != "probe":
        problems.append(f"探针帧异常: {res.stdout!r}")
        return "；".join(problems)
    probe = frames[0]
    if os.path.normcase(str(Path(probe["path0"]).resolve())) != os.path.normcase(str(SANDBOX.resolve())):
        problems.append(f"sys.path[0] 应=entry 所在沙箱目录，实际 {probe['path0']!r}")
    if probe["version"] != _sdk().__version__:
        problems.append(f"沙箱 import constella_sdk 版本不符: {probe['version']!r}")
    return "；".join(problems) if problems else None


# ---------- 套件 ----------
def main() -> int:
    print(f"constella_sdk py 契约验收（T4-11）——解释器: {sys.executable} ({platform.python_version()})")
    if not PKG_SRC.is_dir():
        print(f"[SETUP-FAIL] constella_sdk 包源缺失: {PKG_SRC}")
        return 1
    expected = load_expected()

    # T4-12 两包 semver 恒等断言（K-01 §6.4c）：py __version__ ↔ sdk/package.json version
    # （场景计数外的前置断言——不恒等即 fail fast，不进 12 场景集合）。
    ts_version = json.loads((SDK_ROOT / "package.json").read_text(encoding="utf-8"))["version"]
    assert _sdk().__version__ == ts_version, (
        f"两包 version 不恒等: py={_sdk().__version__} ts={ts_version}（K-01 §6.4c）"
    )
    print(f"[ok] version 恒等 ts=py={ts_version}")

    # 装配错误三态＋caps 子进程态（内联期望=ts contract.test.ts 同文）
    assembly: list[tuple[Expected, dict[str, str]]] = [
        (
            {"id": "boot-ctx-missing", "ctx": None, "exit": 2,
             "frames": [{"type": "error", "name": "SdkError", "message": "缺少 CONSTELLA_CTX 环境变量", "code": "CTX_MISSING"}]},
            base_env(),
        ),
        (
            {"id": "boot-ctx-invalid-json", "ctx": None, "exit": 2,
             "frames": [{"type": "error", "name": "SdkError", "message": "CONSTELLA_CTX 不是合法 JSON", "code": "CTX_INVALID_JSON"}]},
            env_with_ctx(raw='{"params":{'),
        ),
        (
            {"id": "boot-entry-no-run", "ctx": {"params": {}, "input": None}, "exit": 2,
             "frames": [{"type": "error", "name": "SdkError", "message": "脚本未导出 run(ctx)", "code": "ENTRY_NO_RUN"}]},
            env_with_ctx({"params": {}, "input": None}),
        ),
        (
            {"id": "cap-unavailable", "ctx": {"params": {}, "input": None}, "exit": 1,
             "frames": [{"type": "error", "name": "SdkCapUnavailableError",
                         "message": "SDK_CAP_UNAVAILABLE:llm.json（能力未绑定；运行时绑定注入见 02 §14/§12.1）",
                         "code": "SDK_CAP_UNAVAILABLE"}]},
            env_with_ctx({"params": {}, "input": None}),
        ),
    ]

    results: list[tuple[str, str | None]] = []
    try:
        build_sandbox(expected)
        for e in expected:
            res = run_child(SANDBOX / f"{e['id']}.entry.py", env_with_ctx(e["ctx"]))
            results.append((e["id"], check_contract(e["id"], e, res)))
        for e, env in assembly:
            entry = SANDBOX / f"{e['id']}.entry.py"
            if not entry.exists():  # cap-unavailable 复用 cap-access entry
                entry = SANDBOX / "cap-access.entry.py"
            res = run_child(entry, env)
            results.append((e["id"], check_contract(e["id"], e, res)))
        results.append(("caps-inprocess", caps_inprocess_problems()))
        results.append(("sandbox-syspath-reachability", syspath_probe_problems()))
    finally:
        shutil.rmtree(SANDBOX.parent, ignore_errors=True)

    for label, problem in results:
        print(f"{'PASS' if problem is None else 'FAIL'} {label}" + ("" if problem is None else f" —— {problem}"))
    failed = [label for label, p in results if p is not None]
    print(f"{'全部通过' if not failed else '存在失败'}: {len(results) - len(failed)}/{len(results)}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
