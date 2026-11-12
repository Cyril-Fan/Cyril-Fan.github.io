# 近期文章弹窗 / Recent-post dialog

- 仅文章列表滚动，标题、博客链接和关闭按钮保持可见。滚动条贴住右侧内边框（0px 内距），上下与圆角保持距离。
- 保留主题原有的圆头滑块；弹窗实体边框改为 0.5px，不使用内描边或平直滑块右缘。低像素密度下由浏览器按设备像素取整。
- 鼠标在弹窗内部时，列表到达顶部或底部后继续滚动不会传到背景；标题和内边距区域也不会带动背景。鼠标移到弹窗外时可正常滚动背景，不再全局锁定页面。关闭、Esc 或点击遮罩后恢复打开按钮焦点。
- 使用现有原生 dialog 和 CSS 布局，不改变朋友圈数据、刷新逻辑、评论或编辑副本。

Only the article list scrolls. The header and close button stay visible; the scrollbar meets the right border with no inner gap. Wheel scrolling inside the panel never scrolls the background, including over the header or at list boundaries. Outside the panel, the background remains scrollable. Closing restores focus. Feed content and other data are unaffected.

The theme's rounded scrollbar thumb is retained. The dialog uses a 0.5px physical border rather than an inset outline or a flattened thumb. Browsers may round fractional borders to device pixels on low-density displays.

## 验证 / Checks

- 13 项朋友圈隔离测试通过；Astro 检查 0 errors、0 warnings（11 条已有 hints）。
- 浏览器验收覆盖滚到列表两端继续滚动、遮罩滚动、关闭后背景滚动恢复、关闭按钮与 Esc、窄屏换行和横向溢出。
- 本机完整构建及 53 页元数据检查通过；GitHub Actions 再验证完整测试与构建，通过后才部署。
- 手机检查使用 Edge 尺寸模拟，不代表实体 iPhone Safari 验收。

Focused feed tests and type checking passed. Browser checks exercise both scroll boundaries, the backdrop, closing and restored scrolling. Deployment is gated by the full CI test suite and production build. Mobile verification uses Edge emulation, not a physical iPhone.
