# P6 batch-5 · T6-16 B 线 —— demo 对齐 walk 走查报告

| 字段 | 内容 |
|---|---|
| 编号 | docs/research/P6-收口/demo-walk-报告.md |
| 日期 | 2026-11-11 |
| 执行 | T6-16「收尾打磨」B 线（demo 对齐 walk） |
| 事实源 | prototypes/demo.html（v0.5.0-demo，4780 行，交互事实源）＋ docs/01-PRD-产品需求文档.md（A 清单 GWT，已封版） |
| 对照实现 | client/src/renderer/（装配=assembly/，画布=canvas/，运行=run/，工坊=workshop/，任务中心=taskcenter/，广场=market/，设置=settings/，星空=sky/）＋ client/src/main/（种子=storage/migrate/，示例资产=zip/） |
| 约束 | 只读走查；偏差只登记不上线修复；处置=V1 微调候选（低成本）/V2/B2 移交（结构性） |

---

## ① 走查口径与方法

1. **走查单位**＝01 §4（PRD-A1-01 ~ PRD-A16-01，54 条）＋ §5（PRD-CUSTOM-N1~N8、PATH1、PATH2，10 条），共 **64 条**。每条按其 GWT 展开，demo 行号锚取 01 文内标注（如保存 toast L1643、定位脏闸 L2795-2797）。
2. **三维判定**：视觉（布局/尺寸/配色 token）／交互（行为/时序/边界）／文案（toast/按钮/标签逐字）。三维全过=对齐；任一维不符=偏差（列维度与证据）。
3. **判定档与豁免**：
   - 「**无锚跳过**」＝demo 无对应物的正式版新增域（A-4.06 试跑 UI、A-2.04 重命名/删除、A-6.06 cron 调度、PATH1 手动编辑器）——按任务口径标注「demo 无锚——以 03 卡验收为准」，不做三维对齐（附一句话现状）。
   - 「**合规非偏差**」＝mock→真实化的既定替换（B 清单表态、02 §14 裁定）：如 demo `@flowforge/sdk` L1036 作废（02 §14 已裁，实现用 `@constella/sdk` 合规）；「已提交审核 [mock]」→真实审核流 toast；危险区「重置演示数据」→「恢复出厂」（PRD-A14-03 正式语义）；B-4 断点真实上游数据替换 MOCK_JD；X-12 列表分块为正式采纳增项。此类不计偏差，列于 ④。
   - 「**已登记并入**」＝05 各批 T6-17 移交表既有登记项（assetScriptPath 绝对解析／CDP 管理面挂载／Publisher·MinePublishments 入口／plazaQuery DTO 对齐／optimize 差异卡链与流式文本／壳视觉对齐〔含 header 保存/取消/undo/redo/版本下拉按钮〕）。本 walk 对其**细化举证但不重复立项**，明细表中标注「已登记（细化）」。
4. **重点逐字核对过的文案族**：连线三查（L1524/1526/1528）、运行三闸（L1792/1793/1796）、定位脏闸（L2796）、任务状态五值（L2774）、空态三则（L2772/L741/L2974）、断点卡全套（L1980-2012）、导入缺脚本（L2642）、星野重建（L2744）、保存 toast（L1643）、错过触发提示（PRD-A6-06 冻结文案）。
5. 不确定处标「待复核」，不臆断。

---

## ② 总览统计

| 判定 | 条数 | 说明 |
|---|---|---|
| 对齐 | **31** | 三维过（含少量微差注记，见明细表尾「对齐注记」） |
| 偏差 | **29** | 其中 6 条为已登记移交项的细化举证（不重复立项）；新登记 23 条 |
| 无锚跳过 | **4** | A-2.04／A-4.06／A-6.06／PATH1（demo 无对应物，以 03 卡验收为准） |
| 合计 | 64 | 01 §4 54 条＋§5 10 条 |

**上线级阻断偏差（B1 gate 视角）：有 2 项**（详见 ⑤，置顶）——A-15.01 种子流程构成不符（3 条种子无触发节点不可运行，01 §9 剧本不可走查）与「手动运行入口缺失」（壳 header 按钮组未装配的 Functional 子集）。其余偏差均为体验/一致性级，不阻断 B1。

---

## ③ 偏差明细表（29 条）

处置档：**[阻断]** 上线前必须收口／**[V1 微调]** 低成本候选／**[V2/B2]** 结构性移交／**[已登记]** T6-17 移交表既有项细化。

| # | A 编号 | demo 锚行 | 实现位置 | 偏差维度与描述 | 建议处置 |
|---|---|---|---|---|---|
| 1 | **A-15.01 九条种子流程** | L1080-1226（F1~F9 构成）；01 §9 剧本 | client/src/main/storage/migrate/seed-data.ts:148-229 | **交互/内容（重大）**：实现种子 f1~f9 为 2~3 节点最小流程（「示例·手动数据加工」等），与 demo/01 §9 冻结构成完全不符（F1 七节点 branch 双路、F3 断点 5 选项、F4 十一节点三 lane 汇合、F5~F9 MA-1~MA-5 种子版均无）。**且 f4（cdp.open→cdp.extract）、f5（cdp.extract→logic.branch）、f8（cdp.extract→cdp.click）无 ins=[] 触发节点，被运行闸（A-6.1 第③闸）拒绝，不可运行**——违背 A-15.01「9 条可直接运行的示例流程」与 00-D 验收 D-8 剧本载体。 | **[阻断]** 上线前重制种子（按 01 §9 构成对齐 demo L1085-1226；f4/f5/f8 至少补触发节点） |
| 2 | **A-6.1/A-5.1 运行与编辑入口** | L633-647 canvasHead（▶ 运行/■ 终止/编辑/保存/取消/↶↷/↺ 重置/flowSelect/新建） | client/src/renderer/assembly/app-shell.tsx:194-259（顶栏无上述按钮）；run 引擎 startRun 无 UI 调用点（仅 cron 调度可达） | **交互（功能级）**：画布头按钮组整面未装配——**用户无「▶ 运行」入口**（手动 run 仅理论可达）、无编辑/保存/取消/撤销/重做/版本/流程切换/新建入口（store 与编排链均已备：flow-store dirty/editMode、save.manual、HISTORY_LIMIT=60、versions.restore）。属 T6-17 移交表「壳视觉对齐」登记面，但运行入口缺失超出视觉范畴，单列置顶提示。 | **[阻断]**（运行/编辑/保存最小集）＋其余 [已登记]（细化）壳视觉对齐 |
| 3 | A-4.04 节点抽屉 create/edit 表单 | L2036-2132（create=类型网格+名称+参数表单+「添加节点」；edit=名称框+参数） | client/src/renderer/canvas/drawer/DrawerShell.tsx:84-145（create 仅类型网格，点选即落图缺省编排 CanvasChrome.tsx:206-224）；DrawerContent.tsx:47-102（edit 无名称输入框，requestSave 仅 patchNode params） | **交互（重大）**：①create 态无名称/参数填写环节（demo 冻结「先选类型→填名称/参数→添加节点」）；②edit 态无节点名称编辑框——**UI 层节点不可改名**（叠加上下均无流程改名，命名链断裂）；③非编辑态双击无 demo 引导 toast（L1564「先点「编辑」才能修改节点」/L1567「先点「编辑」，再双击画布新建节点」——CanvasChrome.tsx:157-159 静默 return）；④节点单击（编辑态）不开抽屉（demo L1514-1517 plain click 即开）。 | **[阻断]**（create 表单+edit 名称框）＋其余 [V1 微调]（两条 toast） |
| 4 | A-11.01 节点库 rail | L615-628（左 rail：libList/libCount）；L2474-2499（renderLib：条目=图标/名称/类型串/参数数/·📜py/ts；点击同名定位闪烁/否则视口中心带参新建；空态 L2477「AI 开发的节点会出现在这里」） | 无对应组件——app-shell 无左栏；library 仅 storage ops+入库链（market/installer、canvas drawer 注入位） | **交互+视觉（功能面）**：节点库列表 UI 整面缺失（列表渲染/点击定位/带参新建/空态文案均无落点）。超出「壳视觉对齐」纯视觉范畴，属功能面缺口。 | **[V2/B2]**（rail 组件+装配）或随壳对齐一并收口 |
| 5 | A-4.02 九强节点清单 | L893-938（gate.login/xhs.search/xhs.detail/data.vault/ai.classify/ai.copygen/xhs.dm.send/**xhs.comment.post**/xhs.auto-reply） | client/src/main/zip/example-assets.ts:47-51＋client/assets/examples/（9 zip：含 net.fetch、**无 xhs.comment.post**） | **交互/内容**：冻结清单 9 项仅 8 项落地；xhs.comment.post 缺席（F7 智能评论剧本与 MA-3 无种子载体），以 net.fetch（ctx.net 面示例，03 卡面裁定增补）补足数目。net.fetch 增补=卡内裁定合规；comment.post 缺失无在案裁定。 | **[V1 微调]**（补 xhs.comment.post.zip，gen-examples 管线现成） |
| 6 | A-4.05 抽屉入库生产接线 | L2135-2145（📥 入库→toast「「name」已保存到节点库」/「已在库中 — 参数模板已更新」；L2137「先填节点名称再入库」） | DrawerShell.tsx:189-191（入库按钮 onLibraryUpsert 注入位）；app-shell.tsx:266（CanvasChrome 未传 drawer props→**生产装配下点击无操作**） | **交互**：入库按钮在位但生产壳未注入回调（静默 no-op）；demo toast 文案族未落。 | **[V1 微调]**（壳层接线 library.upsert+toast，一天内当量） |
| 7 | A-1.02 环境状态 pills | L607-611（电脑环境/CDP 已连接·未连接/MCP 5 工具）；L745-752（MCP popover）；L2650-2659（pill 交互） | app-shell.tsx:194-259（顶栏无 pills 区）；main 侧 env:systemInfo 通道已备（runtime/app-runtime.ts） | **视觉+交互**：三 pill 整组缺失（B-9 真实化数据面已备、UI 无落点）；MCP popover 缺（P2 定级——pill 清单展示为 V1 范围）。 | [已登记]（细化）并入壳视觉对齐；MCP popover 随 pill 一并 |
| 8 | A-1.03 底栏 | L716-725（身份 Yeager·管理员/storeState 已同步·HH:MM／● 未保存—点击保存（blink）/自动保存 关·点击切换/asBadge toast「自动保存已开启/关闭」/会话时长 1s/版本号） | app-shell.tsx:243-258（仅顶栏「自动保存」静态徽标，无点击切换、无文案「关」；footer 整面无） | **视觉+交互+文案**：底栏整面缺失；未保存徽标/点击保存/会话时长/版本号/登录身份均无落点；自动保存徽标交互（点击切换+toast）缺失。 | [已登记]（细化）并入壳视觉对齐；正式版身份按 D-1 登录态（LoginDialog 已有） |
| 9 | A-1.01 顶栏形态 | L590-612（品牌+`DEMO` 版本徽标〔正式版 semver〕；导航三顶=工作流/系统设置/任务中心） | app-shell.tsx:194-259（无版本徽标〔app:version 通道已备〕；导航 6 项=⌖工作流〔点击=fitView，demo 无此绑定〕/任务中心/系统设置/广场/✨工坊/＋节点；品牌无 SVG 图标） | **视觉+文案**：导航数与分组偏离 demo 三顶制（广场/工坊/＋节点在 demo 位于 rail 底与右栏）；无版本徽标。 | [已登记]（细化）并入壳视觉对齐；导航信息架构是否回归三顶=PM 裁决 |
| 10 | A-1.04 toast 形态 | L1271-1277（底部居中，2.6s 后 320ms 淡出；err/ok 级别配色） | canvas/toast.tsx:36-50（3.2s 直消无淡出、无级别样式——app-runtime notify(level,msg) 在 app-shell.tsx:98 丢弃 level）；样式 tailwind.css:274-287 位置对齐 | **视觉+交互（时序）**：时长 2.6s+fade→3.2s 硬切；err/warn/ok 无配色分级。 | [V1 微调]（时长/淡出/级别样式三点小改） |
| 11 | A-1.04 Esc 层级序 | L1573-1577（CDP 查看窗→抽屉→任务中心→弹窗〔含 MCP popover〕） | EditorKeyboard.tsx:30-32（Esc 关抽屉）；task-center-panel.tsx:44-52（escGate 仲裁）；app-runtime.ts:390-396（escGate 注释明示 CDP 查看窗位待挂载） | **交互**：四层序中 CDP 查看窗层缺位（组件未挂载——随 #16）；抽屉/任务中心/弹窗三层已在。 | [已登记]（随 CDP 挂载收口） |
| 12 | A-2.01 流程下拉与切换 | L1694-1708（下拉+● 后缀+脏闸回弹+切换语义）；L1701 toast「有未保存改动 — 先保存或取消再切换」 | 无下拉 UI；切换链仅任务中心定位路径（locate-run.ts 脏闸文案 LOCATE_DIRTY_TOAST=「有未保存改动 — 先保存或取消」逐字 ✓） | **交互+文案**：流程切换入口缺失（切换语义底座在 flow-store.loadFlow/locate 编排已备）；「再切换」专属 toast 随 UI 缺。 | [已登记]（细化）并入壳视觉对齐 |
| 13 | A-2.02 新建流程弹窗 | L796-804（名称弹窗 maxlength=30）；L1709-1722（脏闸→创建→进编辑→落盘→toast「已创建「name」— 双击画布添加节点」；空名兜底「未命名流程」） | 无弹窗 UI；flows.create op+初始版本（T1-04「flows.create 打初始版本」）已备 | **交互+文案**：新建入口与引导 toast 缺。 | [已登记]（细化）并入壳视觉对齐 |
| 14 | A-2.03 删节点 toast | L1724-1733（删除连带边+可撤销 ✓；toast「节点已删除」+warn 日志「删除节点：name」） | flow-store.removeNodeCascade（连删边+单历史项 ✓）；EditorKeyboard.tsx:36-44 / DrawerShell 删除按钮——**无 toast/日志** | **文案（轻）**：交互/撤销对齐；删除反馈 toast 与日志行缺失。 | [V1 微调] |
| 15 | A-3.04 连线建立反馈 | L1520-1533（三查 toast 逐字 ✓〔connect-validator.ts:22-31〕；建边日志「连线：X → Y」）；非编辑态 demo 不起连线（L1471） | use-interaction-machine.ts:38-40（非编辑态**新增** toast「编辑模式下才能建立连线」——demo 无此文案）；建边日志行缺失 | **文案（轻）**：三查逐字对齐；多出一条 demo 外 toast、少一条建边日志。 | [V1 微调]（对齐取舍：去 toast 或留档知悉） |
| 16 | A-3.06 空流程引导 | L661/L1390（虚线卡「空流程 / 双击画布新建节点 · 或在右侧对 AI 说一句话，生成整条流程」） | CanvasChrome.tsx 全文无 emptyHint 对应物（仅 grep 命中无关文案） | **视觉+文案**：空流程引导卡缺失。 | [V1 微调]（低成组件） |
| 17 | A-4.04 抽屉区块缺项 | L2051（「不会选？」兜底文案）；L2065（📘 doc 说明+「输出口即路由：true / false」）；L2067-2070（📜 资产包区+「查看脚本」折叠预览）；L2071（只读提示「当前是只读视图 — 点『编辑』后才能修改」） | DrawerShell.tsx:151-152（只读文案=「运行中：节点只读」/「只读模式」）；DrawerContent.tsx:85-99（📜 元信息区有、**查看脚本折叠无**〔T6-09 batch-4 登记生产接线留 T6-16〕）；📘 doc 区无；类型网格=按类目分组（demo 平铺） | **视觉+交互+文案**：doc 说明区/兜底文案/查看脚本折叠缺失；只读提示文案不同名。 | 查看脚本 [已登记]（T6-09 接线）；📘 doc/兜底文案/只读文案 [V1 微调]；网格分组 [V2/B2 或知悉] |
| 18 | A-4.04 抽屉动作区 | L2073-2079（顺序=删除｜spacer｜📥 入库/取消/保存〔edit〕或添加节点〔create〕；「节点名称不能为空」L2114） | DrawerShell.tsx:170-195（顺序=保存/取消/删除/入库/试跑；文案「入库」无 📥；无 create 态动作〔见 #3〕；名称校验文案无落点〔名称框缺〕） | **视觉+文案（轻）**：按钮序/emoji/文案族微偏。 | [V1 微调]（随 #3 一并） |
| 19 | A-5.01/A-5.02 脏标记三处联动+取消 | L637（dirtyDot「● 未保存」）/L1303-1319（保存取消使能/storeState 三态）/L1647-1654（doCancel 快照还原+toast「已还原到上次保存」） | flow-store dirty/editMode/markSaved+save-orchestrator（落盘+版本+基线+清栈 ✓，doSave 五步语义齐）；**取消按钮/doCancel 编排/toast 无 UI 落点** | **交互+文案**：引擎侧保存链完整对齐；取消还原路径与三处联动视觉缺失。 | [已登记]（细化）并入壳视觉对齐（取消按钮为最小集） |
| 20 | A-5.04 版本弹窗 | L806-812（↺ 重置弹窗：倒序列表+底注「每次保存自动记录，最多保留 20 个版本」）；L2996-3006（恢复→dirty→可撤销→toast「已恢复到「label」— 可撤销或保存」） | versions 栈 LIFO 20 ✓（storage/save-pipeline、versions-dao）；flow-store.restoreVersion ✓（roundtrip 呈 dirty）；**弹窗 UI/底注/恢复 toast 无落点** | **交互+文案**：引擎齐、UI 缺。 | [已登记]（细化）并入壳视觉对齐 |
| 21 | A-6.04 收尾 toast | L1953-1954（warn toast「「name」已终止」err / toast「「name」运行完成 ✓」） | run-engine.ts:108-127（终态日志三式逐字 ✓）；**finish toast 未发**（notify 仅闸门失败路径 run-engine.ts:165） | **文案（轻）**：日志对齐、收尾用户反馈 toast 缺。 | [V1 微调] |
| 22 | A-8.02 CDP dock/查看窗挂载 | L665-668/L2824-2868（dock 徽标/列表/查看窗/✕ 语义） | CdpDock.tsx（件齐：徽标/列表/去协议头 URL/:端口 ✓）、SessionViewer.tsx:123（✕ title「关闭窗口（分支会话继续运行）」逐字 ✓）——**app-shell 未挂载** | **交互**：组件级三维全对齐，挂载位缺（escGate 注释明示登记）。 | [已登记]（CDP 管理面挂载——T6-17 移交表） |
| 23 | A-10.01 双工坊双 tab | L679-682（节点工坊/流程工坊互斥 tab）；L2330-2338（switchRail） | workshop-panel.tsx:8-9 自认「轨道 tab 双栏未实装——单栏对话流承载」；handoffToFlowWorkshop 单栏内转交 | **视觉+交互（结构）**：双 tab 互斥面板未实装（流程工坊独立输入面/示例 chip 随之缺，见 #24）。rail 状态字四态 ✓（缺「编辑中」态）。 | [V2/B2]（或随壳对齐最小双栏） |
| 24 | A-10.02/A-10.03 工坊入口件 | L688-693（节点工坊 4 快捷 chip）；L704-709（流程工坊 4 示例 chip）；L701-702/L2340（三来源说明+统计行「📚 节点库 N 项 · 🏬 广场 M 项 · ✨ 现场开发随叫随到」）；L3114（开场白）；L2277（计划卡「重新规划」钮） | workshop-panel.tsx:235-308（输入框+发送，**无任何 chip**；空态文案自拟≠demo 开场白）；PlanCardInline（✨ 一键生成 ✓、**无「重新规划」**）；来源统计行无 | **视觉+文案（轻）**：chip 组/统计行/开场白/重新规划缺；计划卡主体与三来源标记 ✓。 | [V1 微调]（chip/文案批补）＋重新规划 [V1 微调] |
| 25 | A-10.02/A-10.04 optimize 差异卡+流式 | L2395-2407（差异卡「追加：失败重试 ×3 · 超时 10s」+应用）；L2352-2361（22ms 假流式） | workshop-panel.tsx:216-224（optimize=LLM 文本应答代位；真流式未实装——llm-gateway chatJson 非流式） | **交互**：T6-17 移交表既列（optimize 差异卡链与流式文本）。正式版语义=B-8 真流式。 | [已登记]（optimize 差异卡链与流式文本——T6-17 移交表）；B-8 真实化收口归后续波 |
| 26 | A-12.02/A-12.03 zip 导入导出入口 | L625-626（rail 底「导入」「导出」按钮+隐藏 file input L629） | zip 管线全对齐（export-orchestrator 默认名 constella-<流程名>.zip/空流程拒绝；import-orchestrator.ts:243-246 toast「已导入 N 个节点」+「⚠ N 个节点缺脚本，运行会失败」逐字 ✓；waterfall-placer 36/40 ✓）；**壳层无导入/导出按钮** | **交互**：引擎三维过、入口缺（发布链 PublisherDialog 内可用导出产物，但用户直导入口无）。 | [已登记]（细化）并入壳入口收口（与 #4 rail 或顶栏一并裁决） |
| 27 | A-13.01 发布入口 | L622（rail「发布」按钮） | PublisherDialog.tsx（弹窗本体对齐：二选一/名称 24/简介 40/权限推导「无特殊权限」/自动建议未聚焦才覆盖 ✓）；MinePublishments.tsx ✓；**壳层无发布入口** | **交互**：件齐挂缺。 | [已登记]（Publisher·MinePublishments 入口——T6-17 移交表） |
| 28 | A-13.03 广场卡片微差 | L817-820（tab「节点广场/流程广场」）；L3032-3036（卡片：节点数徽标/📜 含脚本徽标） | MarketBrowser.tsx:180-196（tab=「节点/流程」）；卡片以 version/kind 徽标代位节点数/📜（MarketBrowser.tsx:4-5 自注「DTO 无字段支撑——偏离已列报告」） | **文案+视觉（轻）**：tab 名非 demo 逐字；两徽标代位（X-01 DTO 冻结所致，T5-11 已列）。安装按钮文案「下载/登录后下载」vs demo「安装」=X-01/D-1 口径（知悉非偏差）。 | [V1 微调]（tab 文案）＋徽标 [已登记]（plazaQuery DTO 对齐族） |
| 29 | PRD-CUSTOM-N8 升级提示 | demo 无锚（D-11 正式承诺）：广场卡片+库条目「广场有新版本 v1.1.0」提示 | MarketBrowser/MinePublishments 均无「新版本/升级」字样（grep 零命中）；版本字段/semver 首发 v1.0.0 ✓（PublisherDialog 尾注） | **交互（正式承诺未落）**：单版本覆盖更新链未含升级提示 UI（V1=重装即更新语义在，提示面缺）。 | [V2/B2]（或 V1 微调：广场卡片 condition 渲染一行） |

### 对齐注记（计入「对齐 31」的微差，不立项）

- **A-3.01**：缩放边界 25%–200%（CanvasChrome.tsx:35-36）✓、Space 平移/网格 24px/拖拽吞 click（xyflow 内建）✓、fitView 空流程复位 {60,40,1}（app-runtime.ts:106-113）✓、panToNode 居中+闪烁 ✓。微差：缩放条无「⌖」钮（复位由 xyflow Controls 承担，Controls/MiniMap 为 demo 无的正式新增）。
- **A-3.02**：192px（tailwind.css:55）/五态徽标 ⋯✓✗⊘⏸（NodeCard.tsx:17-23）/首参预览 26 字截断（NodeCard.tsx:51-59）/触发无入口/多出口等分+标签（NodeCard.tsx:90-109）全对齐。微差：类型行尾标「✨」vs demo「✨自研」（NodeCard.tsx:80）——文案两字差，随手可改，登记为知悉。
- **A-6.03**：「运行脚本 scripts/<file>（Python · 入口 run）」日志形态等价（exec-dispatcher.ts:188）；noScript 拦截移至运行闸前置（run-gate.ts:34-40，02 §12.4 冻结口径），toast 文案「强节点「name」缺少脚本」vs demo「任务失败：name 缺少脚本」措辞异、语义同——知悉。
- **A-8.01**：lane 会话/partition/端口池（main cdp/）✓、run 收尾统一销毁（abort-coordinator destroySessions）✓。「CDP 会话 :port 就绪」日志文案未见对应（renderer/main grep 零命中）——**待复核**（main 侧日志面未逐一展开）。
- **A-9.01**：tab 名「任务」vs demo「任务表」（task-center-panel.tsx:105/114）——文案微差知悉；其余（480px/遮罩/状态五值/当前节点「·」连接/进度/端口/1s 心跳/终止/定位+脏闸逐字）全对齐。
- **A-9.03**：面板 380×300/重放/实时滚底/切流程重放/空态逐字 ✓；开面板按钮位=顶栏「📋 日志」vs demo 画布右下「❯_ 日志」（app-shell.tsx:249-257）——归 #9 壳视觉族知悉。

---

## ④ 已冻结对齐项清单（逐字/语义冻结且实现对齐——抽样举证）

| 冻结口径 | demo/PRD 锚 | 实现证据 |
|---|---|---|
| 连线三查 toast 逐字（不能连接自己/「X」是触发节点，没有输入口/这条连线已存在） | demo L1524-1528 | connect-validator.ts:22-31（注释明标逐字） |
| 运行三闸 toast 逐字（先保存再运行/该流程已有任务在运行/流程缺少触发节点（手动/定时）） | demo L1792-1796 | run-gate.ts:25-31 |
| 定位脏闸 toast 逐字「有未保存改动 — 先保存或取消」 | demo L2796（**已冻结对齐**口径） | locate-run.ts:11-12（LOCATE_DIRTY_TOAST） |
| 保存 toast 逐字「已保存到本地」 | demo L1643（**已冻结对齐**） | app-runtime.ts:231（注释标 demo L1643 逐字） |
| 任务状态五值（运行中/待确认/已完成/失败/已终止）与空态「暂无任务 — 点「▶ 运行」启动…」 | demo L2772-2774 | run-row.ts:66-72（STATUS_LABEL）、run-table.tsx:30 |
| 日志空态「暂无日志 — 跑一个任务试试」/清空后「已清空」/流程日志空态「该流程还没有日志 — 点「▶ 运行」」 | demo L741/L2684/L2974 | global-log-tab.tsx:9-11、flow-log-panel.tsx:18 |
| 断点卡全套（头「run 名 · #id」/问题/数据块/多选 chip/「补充要求…（可选）」/「跳过/确认并发送」/结果标「已选 N 项 + 补充」「已跳过 — 原始数据直接下发」） | demo L1971-2013 | hit-card-view.tsx:148-264（逐字）＋X-12 列表分块（114-127） |
| 导入缺脚本 toast 逐字「⚠ N 个节点缺脚本，运行会失败」＋瀑布排布 36/40px | demo L2642/L2629-2630 | import-orchestrator.ts:246、waterfall-placer.ts:7-8 |
| 星野重建 toast「星野重建中 — <k> <v>%」 | demo L2744 | settings-dispatcher（spec 断言逐字） |
| cron 错过提示「上次计划触发 <时间> 未执行，可手动运行」（PRD 冻结文案，demo 无锚） | 01 PRD-A6-06 | task-notices.tsx:35-37 |
| ✨自定义入口跳工坊+预填「帮我开发一个自定义节点（带脚本资产包）：」+toast 逐字 | demo L2094-2100 | DrawerShell.tsx:117-124＋app-shell.tsx:159-166 |
| ＋节点编辑守卫 toast「先点「编辑」再添加节点」 | demo L2646 | app-shell.tsx:178 |
| 查看窗 ✕ title「关闭窗口（分支会话继续运行）」 | demo L2859 | SessionViewer.tsx:123 |
| 深色 token 体系逐值（--bg/--glass/--tx 族/--accent 族/--red/--amber 全同值） | demo L24-39 | styles/tailwind.css:28-44 |
| @constella/sdk 契约名（demo L1036 @flowforge 作废） | 02 §14 裁定 | sdk/ 包名=合规非偏差 |
| mock→真实化合规族（不计偏差） | B-4/B-11/B-13/PRD-A14-03 | 断点真实上游数据（hit input=data_snapshot）；「已提交审核——审核通过后将在广场上架」（publisher.ts:92）；io 区按 N7 声明展示（IoContractView）；危险区「恢复出厂」（sections.tsx:217） |

---

## ⑤ 结论（B1 gate 视角）

### 上线级阻断偏差（置顶，2 项）

1. **A-15.01 种子流程构成不符且 3 条不可运行**（明细 #1）——f4/f5/f8 无触发节点会被 A-6.1 运行闸拒绝，01 §9 F1~F9/MA-1~MA-5 验收剧本（00-D D-8）不可走查。这不是视觉问题而是验收数据缺陷；需 PM 裁决「按 01 §9 重制种子」或「下调剧本口径」。
2. **手动运行入口缺失**（明细 #2 的功能子集）——壳层无「▶ 运行/■ 终止/编辑/保存/取消」，手动 run 无 UI 可达（当前仅 cron 调度与工坊生成链可间接产生流程态）。T6-17 移交表以「壳视觉对齐」登记，但 walk 判定其中运行/编辑/保存最小集属**功能可用性**而非视觉打磨，建议 B1 收口前单列装配（编排链全部就绪，缺的只是按钮组接线）。

### 其余结论

- **引擎/数据语义层高度对齐**：A-6 运行引擎（三闸文案、BFS、lane 扇出/汇合/死路径、50ms 终止轮询、终态日志三式）、A-7 断点（文案逐字+X-12）、A-12 zip 闭环、A-14 设置、A-16 星空（1:1 移植）、N1~N7 能力模型——三维均过，B1 无语义级回归。
- **偏差主集中在「壳装配面」**：29 条偏差中 12 条（#2/#7/#8/#9/#12/#13/#19/#20/#22/#25/#26/#27）为 T6-17 移交表「壳视觉对齐/挂载/入口」族的细化，方向一致（件齐、挂缺）；建议 B2 前以一张「壳装配收口卡」统一销项。
- **文案纪律良好**：冻结 toast 族 15 组逐字对齐（见 ④）；发现的新增/缺失文案均为轻量（#10/#14/#15/#21/#24/#28），全部 V1 微调量级。
- **待复核 1 处**：「CDP 会话 :<port> 就绪」日志落点（A-8.01，renderer/main grep 零命中——main 侧日志面未逐一展开）。已补核实项：断点终止放行=300ms 轮询（hit-coordinator.ts:20 HIT_POLL_MS）+终止即时 releaseAll，与 demo L1991 语义对齐（A-7.01 维持「对齐」）；demo testNode（L2147）确为无调用死代码，A-4.06「无锚」判定坐实。

— 走查完。本报告为 T6-16 B 线唯一产出物；所有偏差仅登记，未做任何代码修复。
