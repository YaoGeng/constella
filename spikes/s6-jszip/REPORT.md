# S-6 spike 报告：jszip 与 demo 自研 store 互通 roundtrip

日期 2026-11-08｜环境：Windows(Git Bash) / node v24.6.0 / pnpm 12.11.2 / 本机时区 UTC+8｜jszip 锁定 **3.10.2**
demo 逻辑提取：`prototypes/demo.html` **crc32 L2502-2510、buildZip L2513-2546、readZip L2548-2570**（拷入 `src/demo-zip.mjs`，Node 化改造 3 处：Blob→Buffer、注入时间参数、Buffer 池拷贝，均注明且不改字节语义）

## 判据逐条（§15.3 原文：「三向 roundtrip 校验一致」）

| 向 | 双向实测 | 结果 |
|---|---|---|
| 1. jszip store 写↔读 | 9 条（中文/emoji 文件名、4096B 全字节值二进制、空文件×2、4 级目录）：EOCD/central/local 逐字段、文件名 UTF-8 字节、CRC32（demo 实现独立参照）、内容字节级全等；读回再写**包字节级复现**（6201B） | **PASS** 12/12 |
| 2. store 写→deflate 读（及反向） | 原始==store 读回==deflate 读回，9 条字节级三向一致；deflate 读回重写 store 后包字节级复现（6201B/2316B）；空文件 jszip 自动回落 method=0 | **PASS** 3/3 |
| 3a. demo 写→jszip 读 | 6 条文本资产包：文件名/内容字节/CRC32（loadAsync checkCRC32 + demo 参照）/结构全一致；**时间 FAIL**：demo 写本地墙钟 14:30:40（time=0x73D4），jszip 读出 22:30:40，差 +8h（字段=central 目录项偏移 +12 time/+14 date） | **FAIL** 7/8 |
| 3b. jszip 写→demo 读 | demo readZip 全条目读出，文件名/字符串内容/**demo CRC32 自校验**（重算==jszip central 记录）全等；**时间口径 FAIL**：jszip 写 time=0x33D4（UTC 口径）≠ demo 0x73D4（本地墙钟） | **FAIL** 4/5 |

**总判定：FAIL（仅时间字段）**——内容/CRC/文件名/结构三向全部一致；唯一不一致 = DOS 时间写入口径（demo=本地墙钟，getHours/getFullYear，L2516-2517；jszip 3.10.2=UTC），不影响包内容完整性，属显示层差异，已定位到字段与换算量。

## 互通注意事项（V1.0 ZipPipeline 落地规则）

1. **时间换算**：demo 历史包时间字段=写包机本地墙钟，jszip 按 UTC 解释。同机 UTC+8 导入 demo 包，读出时间 +8h；还原=减本机 UTC 偏移。V1.0 统一 jszip 写（UTC 口径）则读写自洽、历史包仅导入侧需换算。
2. **createFolders:false 必须设在 `jszip.file()` 选项上**（`generateAsync()` 同名选项实测无效），否则 demo reader 读到 `nodes/` 等伪空文件条目（实测多 8 条）。
3. UTF-8 flag：非 ASCII 文件名两家都置 **0x0800**（实测非 0x0804）；demo 对 ASCII 名也置 0x0800、jszip 置 0x0000，读端均按 UTF-8 解码，兼容。
4. demo reader（L2561）对 deflate 条目**静默跳过**：混合包只读出空文件且不报错——第三方重打包包 demo 无法导入的实证（TDD L170 风险成立），读端换 jszip 必要。
5. demo 内容契约仅字符串（readZip 用 TextDecoder）；二进制资产仅向 1/2 的 jszip 自身 roundtrip 覆盖。

## 复现

```
cd spikes/s6-jszip && pnpm install && npm run verify   # = node src/run.mjs，exit 0=全 pass
```

## 结论

**jszip 3.10.2 可冻结为 V1.0 zip 实现**：三向 roundtrip 中内容/CRC32/文件名/结构全部一致，N5 点名的 UTF-8 文件名坑实测不存在；唯一遗留为 DOS 时间口径差异（demo 本地墙钟 vs jszip UTC），按上述规则在导入侧换算即可，不阻断冻结。
