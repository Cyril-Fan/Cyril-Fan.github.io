# 依赖安全与验收记录

核对日期：2026-10-20。当前锁文件的完整 `npm audit --json` 和生产依赖 `npm audit --omit=dev --json` 均为 **0 项已知告警**。这是当日 npm 公告库的结果，不是不存在未知漏洞的保证。

## 已完成的依赖迁移

- Astro 从 5.16.8 升级到 **7.4.1**，MDX 升级到 **8.1.0**，Markdown 处理器升级到 **7.3.3**，Shiki 升级到 **4.5.0**。迁移至 Zod 4，并显式保留 unified 的公式、标题、图片和链接处理插件。[Astro 6 迁移指南](https://docs.astro.build/en/guides/upgrade-to/v6/)、[Astro 7 迁移指南](https://docs.astro.build/en/guides/upgrade-to/v7/)
- Tailwind 从 3 升级到 **4.3.3**，使用官方 Vite 插件，移除旧 `@astrojs/tailwind` 集成及其旧 glob / braces 依赖链。保留现有主题变量、class 深色模式、Typography 和原有阴影、模糊、焦点样式。[Tailwind 迁移指南](https://tailwindcss.com/docs/upgrade-guide)、[braces 公告](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
- Typography 仍间接要求旧版 selector parser，因此通过 `overrides` 统一到 **postcss-selector-parser 7.1.7**，并实际构建检查文章排版与 CSS。未来 Typography 更新后应复核能否移除此覆盖。[selector parser 公告](https://github.com/advisories/GHSA-rj75-hqrm-r3gf)
- Sharp 保持 **0.35.5**，KaTeX 保持 **0.18.10**，RSS 保持 **4.0.19**；统一嵌套版本。开发工具 ESLint、TypeScript ESLint 和格式化插件同步升级。没有使用 `npm audit fix --force`。
- CI 使用 Node.js 24。依赖以 `package-lock.json` 锁定；新增依赖或更新锁文件后应重新执行完整审计与相关回归。

## 不可信内容与权限

- 评论 Markdown 先经白名单清理，再交给 `trust: false` 的 KaTeX 渲染器，限制宏展开、尺寸和总公式 DOM 数；超限公式保留可读源码。原始 HTML、脚本、SVG、表单与 iframe 按文字显示。[rehype-sanitize 数学处理顺序](https://github.com/rehypejs/rehype-sanitize#example-math)、[KaTeX 安全说明](https://katex.org/docs/security.html)
- 过滤可执行 URL，外链加入 `noopener noreferrer ugc`，脚注 ID 隔离。外部图片由读者点击后加载，禁止内联 data/blob URL，不发送页面 referrer。URL 校验不能保证域名后续解析及重定向永远不指向私有地址。
- 评论权限由 Supabase 数据库/RPC 校验，前端隐藏按钮不构成授权。站长、普通用户、未验证账户、禁言账户的发布和删除权限分别检查；昵称与头像取当前资料，原作者删除后保留回复及占位。
- 退出或确认切换账户时清除旧草稿、预览和权限；网络故障不被误当作退出。密码显示开关在模式或会话变化时重置。未验证账户显示邮箱验证提示，不再同时显示误导性的登录提示。
- 贡献动画从固定的本人公开仓库获取，经 SVG 元素、属性与资源引用校验后以图片发布。每日贡献数据来自公开贡献 API，检查日期连续性、重复项、数量和总数；网络失败保留已验证快照，不伪造零贡献。
- 图标由一个源文件生成，构建逐页检查版本、导航与基本安全元数据。图片缩放脚本使用本地打包的 `medium-zoom`。页面的 `object-src 'none'; base-uri 'self'; form-action 'self'` 是有限防御，不是完整的 script-src 策略。

## 部署边界

- 网站通过 GitHub Pages 发布静态 HTML、CSS、JavaScript 和资源，没有部署 Astro SSR、服务端 islands、图片端点或 Astro 鉴权中间件。
- Astro、Sharp、Markdown/MDX 与 CSS 插件仍会在本地和 GitHub Actions 构建时执行。恶意仓库内容、图片或外部数据可能影响构建进程或静态产物；静态部署不能代替依赖修复。
- 开发服务器默认仅监听 `127.0.0.1`，不能当作生产服务。Supabase 私钥与邮件服务密钥不进入仓库或前端。

## 本轮验收

- `npm test`：**169 项通过**，包括认证状态、账户切换竞态、Markdown、头像、主题、图标和贡献日历交互。
- `npm run test:database`：本地 PGlite 中 **248 项权限断言通过**，不改动线上留言。
- `npm run build`：Astro 检查通过，**49 个 HTML 页面**的图标/导航元数据检查通过；**1,375 个内部链接、资源与锚点**检查通过。
- `npm run test:content`：临时中英文 MDX、中文回退、草稿过滤、数学、代码、表格、任务列表、脚注、图片、分类/合集、Pagefind 和 RSS 构建通过；临时内容检查后自动移除。
- 官方 Edge 浏览器接口本轮可用。已实际检查 320、390、768、1024、1440 像素视口：首页、博客、学术、友链、关于、搜索和站点说明无横向溢出，桌面双栏和手机头像布局正常。动画/日历切换的外框大小相同，手机日期查询与桌面悬停可显示真实贡献数。
- 评论角色界面使用本地隔离的模拟身份验收；真实注册/登录/找回界面仅检查布局与交互。本轮没有新建真实账户、发送验证邮件或删除线上留言。浏览器手机视口不等同于实体手机硬件测试。
