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
