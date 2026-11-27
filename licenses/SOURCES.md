# 许可证全文来源与校验

本项目采用 **AGPL-3.0-or-later**（路线 A）。以下三份文本是 GNU 官方发布的
逐字副本，获取于 2026-11-27，随发行版一同分发。

| 许可证 | 文件 | 字节数 | sha256 | 用途 |
|---|---|---:|---|---|
| AGPL-3.0 | `licenses/AGPL-3.0.txt` | 34523 | `0d96a4ff68ad6d4b6f1f30f713b18d5184912ba8dd389f86aa7710db079abcb0` | 项目自有代码许可证；LICENSE 正文即本文件的逐字副本 |
| GPL-3.0 | `licenses/GPL-3.0.txt` | 35149 | `3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986` | GPLv3-or-later 组件，可按 AGPLv3 §13 与自有代码组合 |
| GPL-2.0 | `licenses/GPL-2.0.txt` | 17984 | `edaef632cbb643e4e7a221717a6c441a4c1a7c918e6e4d56debc3d8739b233f6` | 7 个纯 GPL-2 独立组件（FSF 判定与 AGPLv3 不兼容，按 mere aggregation 独立分发） |

上游原文地址：

- AGPL-3.0: https://www.gnu.org/licenses/agpl-3.0.txt
- GPL-3.0: https://www.gnu.org/licenses/gpl-3.0.txt
- GPL-2.0: https://www.gnu.org/licenses/gpl-2.0.txt

## 为什么需要三份

- **AGPL-3.0**：项目自有代码的许可证；根 `LICENSE` 的正文即本文件的逐字副本。
- **GPL-3.0**：`gpl3-or-later` / `gpl2-or-gpl3` 组件，按 AGPLv3 §13 可组合。
- **GPL-2.0**：以下 7 个包是纯 GPL-2（无 or-later、无双许可），
  FSF 明确与 AGPLv3 不兼容：`conf.design`、`combinat`、`sets`、`polynom`、`vcd`、`scatterplot3d`、`rbibutils`。
  它们只能作为**独立运行时组件**分发（标准 R library 目录、由 R 自身动态加载），
  不得静态整合进自有代码；合规依据是 GPLv2 §2 *mere aggregation* 例外。

## 复跑与校验

```bash
node spike/scripts/license_texts.mjs --fetch   # 联网重建（维护期，手动）
node spike/scripts/license_texts.mjs --check   # 离线校验（CI，零外网）
```

`--check` 会校验三个文件的 sha256、标题行、字节数，以及 `LICENSE` 是否包含
逐字 AGPL 全文与 SPDX 声明；结果同时接入 `verify_licenses.mjs` 的 C11 断言。
上游文本一旦变化，校验会失败并阻止静默替换。

> 本文件是工程合规记录，**不构成法律意见**；正式发布前须由开源合规律师审阅发行包。
