# 应用图标（待补）

`tauri.conf.json` 的 `bundle.icon` 目前是空数组，因此 **可以正常 `cargo check` /
前端开发，但不能产出带图标的安装包**。

正式打包（`tauri build`）前，需要在这里放入 Tauri 2 要求的图标资源：

- `icon.png`（1024×1024，RGBA）
- `icon.ico`（Windows，多尺寸）
- `icon.icns`（macOS，可选）
- `32x32.png` / `128x128.png` / `128x128@2x.png`

可用官方命令从一张 PNG 生成全部尺寸：

```bash
npm run tauri icon path/to/source.png
```

然后把 `tauri.conf.json` 的 `bundle.icon` 改为：

```json
"icon": [
  "icons/32x32.png",
  "icons/128x128.png",
  "icons/128x128@2x.png",
  "icons/icon.icns",
  "icons/icon.ico"
]
```

> 图标属于品牌资产，Phase 1 骨架阶段使用占位空数组，避免把无关二进制塞进仓库。
