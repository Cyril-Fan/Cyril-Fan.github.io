# 页面切换时导航对齐 / Navigation alignment

- 原因：短博客页面没有竖向滚动条，长页面的 6px 滚动条使居中容器横移 3px。各页共用的容器宽度本来相同。
- 修复：在全局 `html` 上预留稳定的滚动条槽；不支持该 CSS 属性的浏览器使用竖向滚动条回退。保留既有容器宽度、手机菜单和滚动时的导航动画。
- 验证：Edge 中通过顶部导航切换首页、博客、学术、友链与关于，名字横坐标从原来的 197px / 194px 统一为 194px（1432px 视口）；科研、技术、日常子分类与英文页面一致。430px、320px 手机模拟尺寸下横坐标均为 17px，无横向溢出；检查中英文、深浅色与手机菜单。
- 12 项相关测试通过；生产构建、53 页基础检查及搜索索引生成通过。手机检查为浏览器模拟，未使用实体 iPhone。

Short pages previously omitted the 6px scrollbar, moving the centered header by 3px. A stable root scrollbar gutter now keeps navigation aligned across short and long pages, with a scrolling fallback for older browsers. Existing page widths and header animations are unchanged. Browser checks, 12 relevant tests, the production build and search indexing passed.
