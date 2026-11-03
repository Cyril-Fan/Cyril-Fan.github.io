# 友链字段与操作提示 / Link fields and feedback

- 交换友链的字段按钮使用块级布局、明确行高和自然高度；Link、Avatar、RSS 在窄屏换行时，各行独立占位，长地址不会压到下一行。
- 复制本站信息、申请模板和单个字段成功后，提示保留 3 秒。连续点击以最后一次成功操作重新计时，较早操作的结果不会覆盖新结果。
- 提示区始终预留完整一行高度，成功提示出现和消失不会推动下方申请说明。复制失败时保留手动复制提示。
- 朋友圈刷新期间显示“正在刷新”，结果提示 3 秒后恢复文章数量；不会折叠已加载的文章或清除留言草稿。
- 代码复制保留更短的 1.6 秒反馈，之后恢复“复制”；连续点击会重新计时。文章、评论和编辑预览共用该行为。

Exchange fields wrap within their own rows on narrow screens. Link-copy confirmations last 3 seconds, with a reserved line preventing layout shifts. Repeated actions restart the timer; failures keep manual-copy guidance. Reading-feed feedback returns to the article count after 3 seconds. Code-copy buttons use a separate 1.6-second confirmation and restore their action label. No content, accounts, comments or editor drafts are changed.

## 验证 / Verification

- 新增中英文复制计时、连续点击、失败及组件移除测试；验证代码复制恢复与连续点击。
- 本地 Astro 检查 0 errors、0 warnings（11 条已有 hints）；正式构建及 53 页元数据检查通过。
- Edge 验证 1440px 桌面及 430 / 375 / 320px 手机尺寸，中英文与深浅色；手机验收为浏览器尺寸模拟，未使用实体 iPhone Safari。
- 本机完整测试中，4 个测试文件被 esbuild 读取用户上级目录的系统权限限制阻止运行；发布流程会在 GitHub Actions 再运行完整测试、数据库测试及构建，全部通过后才部署。

Focused interaction tests and the local production build passed. Responsive checks use Edge viewport emulation, not physical iOS Safari. The deployment workflow reruns the entire test suite and database checks in its clean Linux environment before publishing.
