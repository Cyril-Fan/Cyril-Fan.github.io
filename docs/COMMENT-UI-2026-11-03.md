# 评论与登录交互 / Comment and sign-in interactions

- 登录、注册及找回密码表单使用输入框内的眼睛按钮。切换不改变密码内容；切换表单、登录状态或离开组件时恢复隐藏。按钮保留中英文无障碍名称。
- 每条留言的回复和更多操作位于作者栏右侧，底部对齐。手机菜单使用整条留言的可用宽度，避免文字被挤在窄列中。
- 展开／收起位于正文右下方，与作者栏操作的右边缘对齐；正文和按钮之间保留间距，手机触控区域保持足够高度。
- 长评论按实际渲染高度默认折叠，保留约 18rem 预览（超出不足 2rem 时不折叠）。可随时展开／收起；仅折叠正文，不折叠回复或编辑框。展开状态仅保留在当前页面内存中，刷新留言列表时保留，重新载入页面后重置。脚注和键盘焦点进入正文时自动展开，避免落入裁剪区域。
- 不修改账户权限、数据库记录、留言原文、评论草稿或其他标签页。

Sign-in, registration and password recovery share an inline eye button with accessible labels. Reply and More are aligned in the comment header. Long rendered comments have Show more / Show less controls; replies and composers remain separate. Expansion survives list refreshes in the current page, but resets on page reload. Footnote navigation and keyboard focus reveal clipped content. No account, database or draft changes are involved.

## 验收 / Verification

- 361 项隔离自动测试通过；包括登录可见性复位、长短评论、独立展开、列表刷新、草稿保留及权限回归。
- Astro 检查：0 errors、0 warnings，11 条已有 hints；构建和 53 页图标／导航检查通过。
- Edge 实际浏览器检查：1440px 桌面及 430 / 375 / 320px 手机尺寸，中英文、深浅色；检查眼睛按钮、菜单位置、展开／收起、脚注跳转和横向溢出。手机为浏览器模拟尺寸，未使用实体 iPhone。
- 测试账户与留言仅存在于本机内存模拟环境，未向正式站提交测试内容。

All 361 isolated tests passed. Type-check and production build passed. Browser checks covered desktop and mobile viewport sizes, both languages and themes, with no production test comments or account mutations. Mobile checks used Edge viewport emulation, not a physical iPhone.

Follow-up: Show more / Show less sits below the comment on the right, aligned with the header actions, with spacing above and an appropriate mobile touch target. This changes layout only; expansion behavior and comment data remain unchanged.

## 刷新按钮与贡献图信息 / Compact controls and contribution details

- 评论刷新和加载更多按钮适度收紧：桌面外框 36px，触屏外框 40px，上下各扩展 2px 点击区域，保留 44px 触控范围。登录、提交等主要操作按钮不变。
- 贡献图与动画开关的间距保留 8px；展开数据说明时开关仍停在同一行。数据更新时间和最近检查时间分组展示，窄屏自动换行，更新策略不变。
- 日期选择器旁仅显示当天贡献数；完整日期与贡献数仍保留在方块提示及无障碍名称中。
- 本次局部验证：170 项相关隔离测试通过；Astro 检查 0 errors、0 warnings（11 条已有 hints）；独立目录构建及 53 页检查通过。Edge 检查 1440 / 1280px 桌面及 430 / 375 / 320px 手机模拟尺寸，覆盖中英文与深浅色。未修改正式评论或浏览器编辑副本。

Refresh and Load more use compact borders while retaining 44px touch targets. Contribution details expand below the controls without changing the 8px graph-to-button gap. Data and check timestamps remain distinct; the selected date is no longer repeated beside its input. All 170 focused tests, type-check and isolated build passed. Responsive checks used Edge emulation, not a physical iPhone.

## 2026-11-04：操作反馈与取消回复 / Feedback and cancelling replies

- 已确认成功的留言、资料更新和管理操作提示显示 3 秒；正在处理、需要操作的说明和失败提示不会按此时限自动清除。新提示替换旧提示时取消旧计时，离开评论组件时清理计时器。
- 提示框采用紧凑的上下内边距；在编辑框末尾显示时不叠加底部外边距。
- 取消回复保留输入内容、退出回复模式，将键盘焦点交还原评论，并补偿编辑框移回顶部造成的位置变化，不滚动到顶部编辑框。接近页面底部时仍受浏览器滚动边界限制。
- 148 项评论隔离测试和独立构建通过；浏览器检查覆盖桌面中文浅色和 430px 英文深色。测试使用本机模拟留言与接口，没有修改正式留言、管理设置或其他标签页草稿。响应式模拟不等同于实体 iPhone Safari 验收。

Confirmed successful actions dismiss after 3 seconds; progress, actionable guidance and errors remain until replaced. A new message cancels the previous expiry. Cancelling a reply keeps the draft, returns focus to the original comment and preserves its reading position within browser scroll limits. The 148 isolated comment tests and build passed, followed by desktop and 430px responsive checks without production writes.
