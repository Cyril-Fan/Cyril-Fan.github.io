# Tools 图标 / Tool icons

所有常用工具图标集中在此目录，由 `src/data/tools.ts` 使用 `?raw` 导入，再由主题原有的 `Svg` 和 `ToolSection` 组件内嵌进 HTML。浏览器不再单独请求 PNG、ICO 或 SVG 图标文件。

| 文件 | 来源 |
| --- | --- |
| `vscode.svg`、`chatgpt.svg` | 沿用 Axi 主题已有图形。 |
| `edge.svg` | [gilbarbara/logos 的 Microsoft Edge SVG](https://github.com/gilbarbara/logos/blob/main/logos/microsoft-edge.svg)，源仓库采用 [CC0 1.0](https://github.com/gilbarbara/logos/blob/main/LICENSE.txt)；内嵌渐变 ID 加上 `tool-edge-` 前缀。 |
| `sakuracat.svg` | 依据站长指定的 [SakuraCat 网站](https://sakuracat-cn1.com/) 原有 favicon 重描；保留原色、轮廓和眼睛位置，使用平滑贝塞尔曲线去除像素描摹造成的阶梯。属于本站的矢量转换，并非官方提供的 SVG。 |

新增图标也使用同一流程。SVG 应只包含图形与必要的内联渐变，不含脚本、外部资源、`<image>` 或内嵌位图。保留品牌原色，避免用全局样式覆盖路径颜色。未使用的旧主题图标和 `public/icons/tools/` 位图已移除。

All tool icons are stored here and rendered inline through the existing theme components. There are no separate icon requests or embedded raster images. Keep future icons self-contained, namespace gradient IDs, preserve brand colors, and remove obsolete assets after checking references. SakuraCat is a local smooth vector reconstruction of its original favicon, not an official SVG asset.
