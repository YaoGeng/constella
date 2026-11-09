THIRD-PARTY-NOTICES — constella-sdk（py 包）
=============================================

S-9 分发义务声明位（TDD-K-01 §6.7；`scripts/check-sdk-deps.mjs` 为本声明的红线守护）。

结论：当前零第三方依赖
---------------------

- `pyproject.toml` `dependencies = []`；源码 import 面=stdlib only
  （K-01 §2「py=零三方（stdlib）」红线）。
- 本文件随 `constella_sdk` 包数据（package-data）进入 wheel/sdist，
  与 `py.typed`（PEP 561）同置。

义务
----

依赖增补时（K-01 §8③ PyPI 公开发布＝V2 届时评估）：在此登记逐包许可证与全文，
并同步 client 侧 `client/scripts/gen-notices.mjs` 的取证口径（安装态 LICENSE 优先）。
