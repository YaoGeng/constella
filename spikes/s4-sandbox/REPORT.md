# S-4 验证报告：python 子进程 + env 白名单 + 强杀

日期 2026-11-08 · 环境：Windows 11 (10.0.26200) / Git Bash · 判据出处 02-TDD §15.3（原文：**「超时 taskkill /T、白名单最小 env｜超时进程树全灭；env 仅白名单+CONSTELLA_\*」**）

## 一、判据核对 —— **PASS**（env 项含一处平台语义细化，见 ★；全 suite 19/19 断言 PASS）

| 判据环节 | 实测证据 |
|---|---|
| 超时进程树全灭 | python 三层长眠树 root→child→grandchild（各层上报 pid/ppid，链路自证通过）+ 控制台伴生 conhost.exe。宿主 node 3000ms 超时触发 `taskkill /PID <直接子进程> /T /F`：直接 spawn python.exe 形态杀灭 4 进程、经 py 启动器（多一层 py.exe）形态杀灭 5 进程，taskkill 对每个 PID 报成功；强杀后逐 PID `tasklist /FI "PID eq x" /FO CSV /NH` 枚举，**全部记录 PID = DEAD**（含 conhost），宿主侧 exit 事件 code=1/signal=null |
| child.kill() 反面 | `child.kill()`（Windows 映射 TerminateProcess 仅直接子进程）后：直接子进程消亡，**child/grandchild 两层 python 实测仍存活**；经 py 形态则整个 python 树孤儿化 → child.kill 不可用作沙箱强杀 |
| env 仅白名单+CONSTELLA_* | ★实测 node/Electron（libuv `uv_spawn`）在 Windows 会向子进程 env **强制补齐 11 个系统变量**（缺则从宿主复制，无法关闭）：HOMEDRIVE/HOMEPATH/LOGONSERVER/PATH/SYSTEMDRIVE/SYSTEMROOT/TEMP/USERDOMAIN/USERNAME/USERPROFILE/WINDIR（libuv `src/win/process.c` `make_program_env` 的 required_vars，node 24.6/uv1.51 与 Electron 45 内嵌 uv1.52 同集）。故判据达成语义 =「**传入 env 块**仅白名单+CONSTELLA_\*；os.environ 观测 = 其上再叠加该固定注入集」。最终断言 run（白名单 5 项+CONSTELLA_\* 3 项）：os.environ 键集合与「白名单∪CONSTELLA_\*∪注入集」**严格相等**、注入值==宿主值、CONSTELLA_\* 名值逐项透传 |
| 最小白名单摸底 | 对照实验（python 直连 CreateProcess、env={}，绕过 libuv）：python 3.12.10 **真空 env 可正常启动**（启动硬依赖=无）；`getaddrinfo("localhost")` 失败(gaierror 11003)、**仅补 SystemRoot 即恢复**；`getpass.getuser()` 缺 USERNAME 报错；tempfile 回退 C:\tmp；urandom/uuid/ssl/subprocess(cmd) 均可用 → 白名单成员是策略项而非启动刚需 |
| 工作目录 | spawn 指定独立 cwd → python `os.getcwd()` 实测==该目录（大小写规范化后相等），并在其中落盘 marker 文件成功 |

## 二、锁定版本

| 组件 | 版本 | 说明 |
|---|---|---|
| 宿主 node | v24.6.0（uv 1.51.0） | 系统 node 跑 spike |
| 生产口径 | **Electron 45.2.3 内嵌 node v24.22.2（uv 1.52.1）** | 已用 `ELECTRON_RUN_AS_NODE=1` 实测：env:{} spawn 注入集同为 11 项、无其他泄漏 → 关键行为与系统 node 一致，口径差异已用证据消除 |
| python | **3.12.10**，经 py 启动器解析绝对路径 `C:\Users\yg\AppData\Local\Programs\Python\Python312\python.exe`（`py -0p` 唯一 3.12） | spawn 形参 **`python.exe -I -X utf8 <script>`**：-E/-s 隔离（忽略 PYTHON* 环境注入、不挂用户 site）+ UTF-8 确定性输出 |
| 强杀/枚举 | `taskkill /T /F`、`tasklist /FI ... /FO CSV`（系统自带，零依赖） | taskkill 输出为 GBK 本地化文案（node 按 UTF-8 解码显示乱码，PID 可辨）；存活判定一律用 tasklist 的 ASCII CSV，不依赖该文案 |

## 三、最小白名单清单（供 C-M1 采纳）

- **显式白名单（5）**：`SystemRoot`（getaddrinfo 名解析实际所需）、`TEMP`/`TMP`（**指向 run 私有 tmp 目录**，防泄漏宿主 %LOCALAPPDATA%\Temp）、`PATHEXT`、`ComSpec`（用户脚本 spawn .cmd/.bat 所需）
- **+ CONSTELLA_\***（按节点/运行注入）＋ **libuv 不可关闭注入（11，固定集）**：见上表；其中 `PATH`/`USERNAME`/`USERPROFILE` 会带出宿主值——**需管控必须显式传入覆盖（尤其 PATH）**
- 断言口径：`os.environ 键 ⊆ 白名单 ∪ CONSTELLA_* ∪ libuv 注入集`

## 四、复现命令（spikes/s4-sandbox/，零 npm 依赖）

```bash
cd spikes/s4-sandbox && pnpm install   # 仅生成本地 lockfile（spikes 已移出 workspace）
node run-spike.mjs all                 # kill(正×2/反×2) + env(E0–E3+真空对照+Electron 口径) + cwd
```

文件：`run-spike.mjs`（宿主）、`scripts/tree_demo.py`（三层树）、`scripts/env_probe.py`、`scripts/cwd_probe.py`、`probe-electron.mjs`（借 ../s1-canvas 的 electron 45.2.3 做口径校验，缺失时自动 SKIP）

## 五、结论（强杀机制选型 → C-M1 SandboxExecutor 直接输入）

**选型：超时强杀用 `taskkill /PID <pid> /T /F`**——系统自带、零依赖、真·树杀（实测三层 python＋py.exe 包装层＋conhost 全灭）；`child.kill()` 反面实证只杀直接子进程；Job Object（KILL_ON_JOB_CLOSE）需原生模块、超出依赖选型表，弃。已知边界：/T 按 PID 快照遍历，后代若在杀前被 re-parent 会漏杀 → **C-M1 杀后必须复查**（tasklist 枚举记录 PID、残留补杀；本 spike 即按此实现，实测 0 残留）。出卡直接输入：① python 经 py 启动器**一次解析**绝对路径后直接 spawn python.exe（避免 py.exe 包装层；即便经 py，/T 亦可全杀）② 形参 `-I -X utf8`＋`windowsHide:true`＋stdio pipe ③ 超时到点 taskkill /T /F，exit 观测 code=1/signal=null（勿依赖 signal 名）④ env=白名单 5+CONSTELLA_\*，PATH/TEMP 需管控则显式覆盖 ⑤ cwd 与 TEMP/TMP 同指 run 私有目录 ⑥ 判据「env 仅白名单+CONSTELLA_\*」按 ★ 语义编写（libuv 11 项注入是 Windows node/Electron 宿主的平台事实，非实现可关闭项）。
