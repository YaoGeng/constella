# @constella/sdk —— ts+py 双运行时同构契约包（TDD-K-01）

02 §14 冻结契约的可运行实现（API 文档与类型包——02 §15.4 TDD-K-01 行）。ts 包（本包）
与 py 同构包（`sdk/py/`，发行名 `constella-sdk`）以**同一组 fixture**（`fixtures/expected/*.json`，
S-5 六形态）在两运行时跑出逐帧语义一致的协议输出（`node test/isomorphism.mjs` 互证）。

## 导出面（ts，workspace 内源码直跑）

| subpath | 内容 |
|---|---|
| `.` | 类型面（`NodeCtx`＋browser/llm/net/file/im/vault/agent 七 Cap 接口）＋identity 参考实现 `run(ctx)`；`NodeOut` 自 `@constella/shared/dsl` re-export（K-01 §2 裁决，方向不可反转） |
| `./bootstrap` | 子进程 trampoline `boot(userRun)`——C-M1 SandboxExecutor 生成 entry 时引用（S-5 链路） |

```ts
import type { NodeCtx, NodeOut } from '@constella/sdk';
import { boot } from '@constella/sdk/bootstrap';

export async function run(ctx: NodeCtx): Promise<NodeOut> {
  const p = { ...PARAMS, ...ctx.params };   // 覆盖顺序：内置默认 ← config/*.yaml ← 实例 params（02 §14 冻结）
  ctx.log('hello');                          // → {"type":"log","msg":"hello"}
  await ctx.sleep(100);
  return { data: ctx.input };                // 恰含 data 或 branch 之一（违规=OUT_INVALID）
}
```

py 侧同构：`from constella_sdk import NodeCtx` / `from constella_sdk.bootstrap import boot`
（`py.typed` PEP 561；`NodeOut` TypedDict 为 X-01 `shared/src/dsl/node-out.ts` 的同构复制，
非 import——K-01 §2 裁决「py 侧以共享 fixture 对齐」）。

七 Cap 当前为**未绑定 stub**（任一成员访问即抛 `SDK_CAP_UNAVAILABLE`，V1.0 冻结面）；
绑定实装按 T0-06 会签结论随后续卡落位（K-01 §8① 替换点：换 caps 实现、接口形不变）。

## 子进程协议（stdout JSON 行，S-5①/② 冻结；stderr 不承载）

```
{"type":"log","msg":"..."}                                  ← ctx.log
{"type":"emit","branch":"...","payload":...}                ← ctx.emit
{"type":"result","out":<NodeOut>,"runtime":{node,electron,execPath,sdkVersion}}  ← 成功终帧（恰一且末行）
{"type":"error","name","message","code","stack"}            ← 失败终帧
```

- 退出码：`0`=成功；`1`=脚本错误（run 抛出／`OUT_INVALID`／`SDK_CAP_UNAVAILABLE`）；`2`=装配错误
  （`ENTRY_NO_RUN`/`CTX_MISSING`/`CTX_INVALID_JSON`）。
- env 注入：`CONSTELLA_CTX`（JSON `{params,input}`）＋能力绑定 `CONSTELLA_CDP_WS`/`CONSTELLA_NET_WS`/
  `LLM_BASE_URL`/`LLM_API_KEY`/`VAULT_PATH`/`RUN_ID`/`NODE_ID`（02 §12.1/§14；绑定判据表=K-01 §4）。
- 宿主 spawn：ts＝`ELECTRON_RUN_AS_NODE=1 <bundle>`（esbuild 打包，S-5）；py＝`python -I -X utf8 <entry>`
  （S-4 冻结形参；entry 含 sys.path 前置垫片——见 `sdk/py/README.md` 勘误留痕）。
- 跨运行时异常名映射边界（**六形态外不锁**）：泛型错误 ts `new Error(...)` ≍ py `Exception(...)`
  →帧 `name:"Error"`；其余异常类 ts 按 `err.name`／py 按 `type(e).__name__` 原样保留类名——
  六形态外两侧类名体系不保证逐字对齐。

## 验收命令（K-01 §6；逐字见 05 T4-12）

```
pnpm -F ./sdk exec vitest run contract && pnpm -F ./sdk exec tsc --noEmit   # ts 契约 11/11＋0 error
py -I -X utf8 sdk/py/tests/run_contract.py                                  # py 契约 12/12
node sdk/test/isomorphism.mjs                                               # §6.2 同构：ts/py 帧互证 ok
node sdk/test/esbuild-regression.mjs                                        # §6.5 esbuild 可打包回归（六形态）
node scripts/check-sdk-deps.mjs                                             # §6.6 依赖红线
pnpm -F ./sdk pack --dry-run                                                # §6.4 tarball 含 dts＋双 subpath
pnpm -F ./sdk run build:py                                                  # §6.4 py wheel 冒烟（含 py.typed/notices）
```

## 打包分发（T4-12；npm/PyPI 公开发布=V2，本节为 workspace 内打包冒烟）

- **ts**：`pnpm -F ./sdk run build` → `dist/`（tsc 发射 ESM＋d.ts；d.ts 相对导入改写 `.js`，
  见 `scripts/build.mjs`）。`package.json` 的 `files`＋`publishConfig.exports` 在 `pnpm pack` 时
  切换为 dist 形态（`.`/`./bootstrap` 双 subpath）；workspace 内消费仍走 `src/` 源码直跑不变。
  `prepack` 钩子自动构建——`pack --dry-run` 亦自足。
- **py**：`sdk/py/pyproject.toml`（setuptools 后端；version 单一来源=`constella_sdk.__version__`，
  与 ts 侧 `sdk/package.json` version **恒等**——两侧 harness 各有断言）。wheel 冒烟脚本
  `sdk/scripts/build-py.mjs`（`.tmp` 内自举 venv＋`python -m build`，产物含 `py.typed` 与
  `THIRD-PARTY-NOTICES.md`）。
- 分发合规：两包各随附 THIRD-PARTY-NOTICES（S-9 声明位；当前零三方，`sdk/THIRD-PARTY-NOTICES.md`
  与 `sdk/py/constella_sdk/THIRD-PARTY-NOTICES.md`）。

## 红线（K-01 §2；守护=`scripts/check-sdk-deps.mjs`）

`dependencies = {}`（ts）／`dependencies = []`（py）；import 面 ts 仅 `@constella/shared`＋
`node:` 内建＋相对路径（fixtures/test 的包名自引用豁免），py 源零三方 import；禁止 import
client/admin/server；禁止 Electron API（须在 RUN_AS_NODE 纯 node 下可跑）。
