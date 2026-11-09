# sdk/py —— constella_sdk py 同构运行时（T4-11，TDD-K-01 §1 py 段）

`@constella/sdk`（ts）的 py 同构包：`NodeCtx` 类型面（Protocol/TypedDict）＋identity 参考实现
`run(ctx)`＋bootstrap trampoline（stdout JSON 行协议，帧级同构 ts 侧 `sdk/src/bootstrap.ts`）。
零三方依赖（stdlib only）；`py.typed` PEP 561；不 import X-01／ts 侧任何代码——以共享期望
资产 `sdk/fixtures/expected/*.json` 对齐（K-01 §2 裁决）。

## 布局

```
constella_sdk/          # 包本体（随宿主置入沙箱：包目录与 entry 同置脚本目录）
  __init__.py           # 类型面（NodeCtx/NodeOut 形/Cap re-export）＋identity run＋__version__
  caps.py               # 七 Cap Protocol＋未绑定 stub（访问即抛 SDK_CAP_UNAVAILABLE）
  bootstrap.py          # boot(user_run) trampoline（CONSTELLA_CTX→ctx→run→终帧→exit 0/1/2）
  py.typed              # PEP 561 标记
  THIRD-PARTY-NOTICES.md  # S-9 声明位（零三方自述；随 package-data 进 wheel/sdist，T4-12）
fixtures/               # 六形态 py 对照脚本（ts 侧 sdk/fixtures/s1~s6 的语义映射物）
tests/run_contract.py   # 契约验收 harness（12 场景＋版本恒等前置断言）
pyproject.toml          # 发行元数据（constella-sdk；version 单一来源=__version__）
```

## 验收

```
py -I -X utf8 sdk/py/tests/run_contract.py     # 12/12 通过、exit 0
```

场景集＝六形态（帧序列对拍 `sdk/fixtures/expected/*.json`＋exit 逐场景）＋装配错误三态
（CTX_MISSING/CTX_INVALID_JSON/ENTRY_NO_RUN→exit 2）＋caps 未绑定两态＋沙箱可达探针。
驱动形态：沙箱置包＋生成 entry，spawn `python -I -X utf8 <entry>`（S-4 冻结形参）。

**解释器口径（Windows 本机留痕）**：PATH 上 `python` 解析到 WindowsApps store stub
（不可用）；以 `py` 启动器执行——解析唯一注册解释器 Python 3.12.10（S-4 锁定版本）。

## ⚠ entry 前置垫片（-I⇒-P 实证结论，2026-11-09 T4-11 核对）

Python 3.11+ 的 `-I` 隐含 `-P`（safe path：`python -h`"-I ... implies -E, -P and -s"），
**脚本目录不入 sys.path**——「包目录与 entry 同置即 `-I` 下经 sys.path[0] 可达」不成立，
沙箱内 `import constella_sdk` 直接 ModuleNotFoundError。处置（已裁决批准）：spawn 形参不变，
宿主生成 entry 在冻结两行（`from constella_sdk.bootstrap import boot; boot(entry_mod.run)`）
之前加 sys.path 前置垫片：

```python
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
```

`tests/run_contract.py` 的 entry 生成器（`SHIM`）即该口径的参照实现（C-M1 py entry 生成
按同口径——03 TDD-K-01 §1 py 段该句勘误归协调方处理）。

## 打包分发（T4-12；PyPI 公开发布=V2，此处为 workspace 内打包冒烟）

- **版本恒等（K-01 §6.4c）**：`__version__` 与 ts 侧 `sdk/package.json` version 恒等——
  `tests/run_contract.py` 前置断言＋`sdk/test/isomorphism.mjs` 各有守护。
- **wheel 冒烟**：`pnpm -F ./sdk run build:py`（`sdk/scripts/build-py.mjs`）——在
  `sdk/py/.tmp/buildenv` 自举 venv 装 `build` 前端（本机 3.12.10 未预装，一次性幂等），
  `python -m build sdk/py` 产出 sdist+wheel；断言 wheel 含 `py.typed`＋
  `THIRD-PARTY-NOTICES.md`（package-data）且 METADATA Version==恒等版本。
- **同构契约互证**：`node sdk/test/isomorphism.mjs`（K-01 §6.2）——同一期望集 ts/py
  帧序列剥 runtime/stack 后逐帧深相等＋exit 一致；依赖红线=仓库根
  `node scripts/check-sdk-deps.mjs`（py 源零三方 import）。
- **异常名映射边界（六形态外不锁）**：泛型异常 ts `new Error(...)` ≍ py `Exception(...)`
  →帧 `name:"Error"`（bootstrap.py 注记）；其余异常类 ts 按 `err.name`／py 按
  `type(e).__name__` 保留类名——六形态外两侧类名体系不保证逐字对齐（s4 落在冻结面内）。
