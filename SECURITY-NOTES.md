# 依赖安全记录

核对日期：2026-10-20。本文记录当前 Astro 5 / Tailwind 3 网站的已知风险、最小处理范围及后续迁移要求，不是“静态网站没有漏洞”的保证。

## 2026-10-20 评论与资源更新

- 评论正文开始在浏览器渲染不可信 Markdown，因此 KaTeX 已更新到 **0.18.10**，并通过 `overrides` 统一嵌套版本；已不在本轮审计的受影响包中。HTML 先经白名单清理，再交给 `trust: false` 的公式渲染器，限制宏展开、尺寸和总公式 DOM 数；超限公式保留可读源码。参考 [rehype-sanitize 数学处理顺序](https://github.com/rehypejs/rehype-sanitize#example-math)、[KaTeX 安全说明](https://katex.org/docs/security.html)。
- 原始 HTML、脚本、SVG、表单与 iframe 按文字处理。过滤可执行 URL，外链加入 `noopener noreferrer ugc`，脚注 ID 隔离。外部图片必须由读者点击后加载，禁止内联 data/blob URL；不向图片站点发送当前页面地址。网络目标校验是额外限制，不能保证所有域名的 DNS 或重定向结果永远不指向私有地址。
- 退出或确认切换账户时清除旧草稿、预览和权限；网络故障不被误当作退出。密码显示开关在模式或会话变化时重置。测试覆盖未验证邮箱、普通用户、站长、禁言用户、跨账户响应竞态、幂等与回复占位。
- 移除图片缩放脚本的运行时 CDN 请求，使用锁文件中的 `medium-zoom@1.1.0` 本地打包。页面增加 `object-src 'none'; base-uri 'self'; form-action 'self'`；这是有限的防御措施，不是完整的 script-src 策略。
- 贡献动画仅从固定的本人公开仓库地址获取，验证 SVG 元素、属性及资源引用后作为图片发布，不内联进网页 DOM。构建会逐页拒绝过时图标和第三方可执行脚本引用。
- 本轮 `npm audit --omit=dev --json` 仍报告 **11 个受影响包：1 critical、5 high、4 moderate、1 low**，主要为下文记录的 Astro / Tailwind / PostCSS 链。Sharp 0.35.5 的缓解继续有效，但不等于 Astro 5 获得官方安全补丁。没有将跨主要版本的框架和样式迁移混入本次修改，也没有将审计结果称为零风险。
- 自动化检查不等于真实设备验收：当前官方浏览器接口初始化失败；本轮未完成真实手机／桌面视觉验收、双真实账户发帖、真实上传与收信测试。数据库回归使用本地 PGlite，不改动线上留言。

## 部署与输入边界

- 网站以 `output: 'static'` 构建为 HTML、CSS、JavaScript 和资源文件，通过 GitHub Pages 发布。没有部署 Astro SSR 服务、服务端图片端点、服务端 islands 或 Astro 鉴权中间件。访问网站不会在 GitHub Pages 上执行本项目的 Node.js 构建依赖。
- Astro、Sharp、Markdown/MDX、数学与 CSS 插件会在本地和 GitHub Actions 构建时执行。处理恶意图片、仓库改动、外部数据或不可信内容，仍可能影响构建进程，也可能把恶意 HTML 写进静态产物。
- 评论在浏览器中连接独立的 Supabase 服务。其权限必须由数据库/RPC 验证；前端隐藏按钮不构成授权控制。依赖审计不能替代评论权限、输入处理及数据库策略检查。
- `astro.config.mjs` 的开发服务器默认仅监听 `127.0.0.1`。不要通过命令行覆盖为公开监听，也不应把开发或预览进程当作公开生产服务。

## 本次最小处理范围

已从安装依赖树确认：未启用的 `@playform/compress` 及旧 `@waline/client` 已移除，`@astrojs/rss` 已更新至 `4.0.19`，Sharp 已更新至 `0.35.5`，并通过 `overrides` 覆盖 Astro 使用的嵌套 Sharp。`npm ls astro sharp @astrojs/rss @waline/client @playform/compress --all` 显示 Astro 5.16.8 与根包使用同一份 Sharp 0.35.5，没有旧 Sharp 实例。依赖树确认不能替代图片构建及功能回归。

Astro 5.16.8 自身声明 Sharp `^0.34.0`；仅升级根 Sharp 不会自动满足该版本范围。强制覆盖跨版本范围需要实际图片构建回归。Sharp 0.35.5 包含已修复的 libvips、libheif 和 librsvg；这能处理当前已知图片依赖问题，但不会修复 Astro 的其他渲染或路由漏洞。[Sharp/libvips 公告](https://github.com/advisories/GHSA-f88m-g3jw-g9cj)、[Sharp/libheif 公告](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c)、[Sharp/librsvg 公告](https://github.com/advisories/GHSA-wq5f-xc86-pv6w)

RSS 4.0.19 修复字段 XML 注入。静态构建同样可能把恶意字段写入订阅文件；当前空 RSS 并不代表后续文章没有此风险。[RSS 公告](https://github.com/advisories/GHSA-8j5q-mfj2-5q9q)

2026-10-19 独立执行 `npm --proxy=null --https-proxy=null audit --omit=dev --json`，升级后仍有 **15 个受影响包：1 critical、5 high、4 moderate、5 low**。审计退出码为 1，表示已知问题尚未清零，并非网络查询失败；RSS、Sharp、compress 及其独有依赖已不在报告中。升级前为 21 个受影响包（1 critical、10 high、5 moderate、5 low）。多个包沿同一依赖链重复计入，包数不能理解为独立且可公开利用的漏洞数；“production dependencies”也不等同于“在静态网站访客请求中运行”。

升级后被报告的 15 个包为：`astro`、`@astrojs/mdx`、`@astrojs/tailwind`、`@tailwindcss/typography`、`tailwindcss`、`braces`、`chokidar`、`fast-glob`、`micromatch`、`postcss-nested`、`postcss-selector-parser`、`katex`、`micromark-extension-math`、`rehype-katex`、`remark-math`。其中 critical 仍来自 Astro 版本范围内的 AVIF 公告，尽管其底层 Sharp 已单独升级；这不是官方 Astro 5 安全补丁，也不代表其他 Astro 公告已解决。

## 暂时保留的已知问题

以下为保留 Astro 5 / Tailwind 3 时仍需跟踪的漏洞族。实际可达性是依据当前源码和静态部署方式作出的判断；引入 SSR、CMS、用户上传、外部构建数据或任意 HTML 属性后必须重新评估。

| 漏洞族 / 官方来源 | 当前网站的可达性及限制 |
| --- | --- |
| Astro 远程图片允许列表绕过：[GHSA-g735-7g2w-hh3f](https://github.com/advisories/GHSA-g735-7g2w-hh3f) | Astro 5.16.8 仍在受影响范围。未部署图片处理端点，当前也未配置远程图片模式；访客没有对应的 Astro 运行时入口。未来远程图片配置或构建数据会改变边界。 |
| Astro `define:vars` 脚本转义：[GHSA-j687-52p2-xcff](https://github.com/advisories/GHSA-j687-52p2-xcff) | 使用固定配置的现有脚本未发现访客输入来源。若不可信内容进入脚本变量，静态构建也能产生存储型 XSS；无 SSR 不意味着此类渲染缺陷不存在。 |
| Astro spread 属性名 XSS：[原修复](https://github.com/advisories/GHSA-jrpj-wcv7-9fh9)、[补充修复](https://github.com/advisories/GHSA-f48w-9m4c-m7f5) | 现有组件 spread 来自仓库组件参数，未发现访客控制属性名的路径。不得将评论、CMS 或 API 对象直接 spread 到元素属性。静态产物同样可能被受污染的构建数据影响。 |
| Astro slot 名称 XSS：[GHSA-8hv8-536x-4wqp](https://github.com/advisories/GHSA-8hv8-536x-4wqp) | 当前未发现不可信动态 slot 名称来源。添加外部内容时仍需检查。 |
| Astro transition 指令/动画属性 XSS：[指令值](https://github.com/advisories/GHSA-7pw4-f3q4-r2p2)、[动画属性](https://github.com/advisories/GHSA-4g3v-8h47-v7g6) | 当前未启用 ClientRouter、hydrated framework islands 或动态 transition 指令入口；CSS 中普通 `transition` 声明不是这些 Astro 指令。 |
| Astro server island 参数重放：[GHSA-xr5h-phrj-8vxv](https://github.com/advisories/GHSA-xr5h-phrj-8vxv) | 未使用或部署 server islands，没有当前生产请求入口。 |
| Astro Host header SSRF / base 路径鉴权绕过：[SSRF](https://github.com/advisories/GHSA-2pvr-wf23-7pc7)、[base 边界](https://github.com/advisories/GHSA-376h-93r7-7g6f) | GitHub Pages 不运行 Astro 请求处理器；当前也没有 Astro `base` 鉴权中间件。该判断不适用于将开发服务器公开或未来改用 SSR。 |
| Astro AVIF RCE：[GHSA-26w7-cxv4-gfx2](https://github.com/advisories/GHSA-26w7-cxv4-gfx2) | 官方框架修复为 Astro 7.2.8（要求 Sharp 0.35.4）。当前全部 Sharp 为 0.35.5，已针对该公告的底层图片依赖做版本缓解；Astro 5 的受影响版本范围仍被审计标记。不得把覆盖依赖描述成官方 Astro 5 安全补丁。图片解析是构建时攻击面，不能只考察线上 SSR；后续更换图片服务或依赖树需重新评估。 |
| Tailwind 3 → chokidar / fast-glob / micromatch → braces 栈耗尽：[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) | 官方当前没有 patched braces 版本；更新至 3.0.3 不能修复。现有 glob 来自固定仓库配置，访客不能提交 glob。风险主要为不可信构建配置/开发输入造成 Node 进程拒绝服务。 |
| Tailwind / Typography → PostCSS selector parser CPU 耗尽：[GHSA-rj75-hqrm-r3gf](https://github.com/advisories/GHSA-rj75-hqrm-r3gf) | 修复阈值为 7.1.6。当前对可信源码做构建处理，没有在线解析访客 CSS 的服务。官方亦将可信源码的普通构建排除在可利用情形外。跨主版本强制覆盖前需验证插件兼容。 |
| KaTeX 与数学插件链：[GHSA-238p-pmpm-9mq7](https://github.com/advisories/GHSA-238p-pmpm-9mq7) | 修复阈值为 0.18.2。该缺陷需要已有原型污染或攻击者影响渲染选项原型，再结合不可信数学表达式；KaTeX 本身不会造成该原型污染。当前数学来自仓库文章并在构建时渲染。升级需覆盖 rehype-katex / micromark-extension-math 的嵌套实例并检查公式与 CSS。 |

`@astrojs/mdx`、`@astrojs/tailwind`、`@tailwindcss/typography`、`rehype-katex`、`remark-math` 等可能因上述依赖继续出现在审计结果中。不要使用 `npm audit fix --force` 按建议盲目降级旧集成/数学插件，或未经回归直接改变框架与样式主版本。

## 后续兼容迁移

官方当前 Astro 为 7.4.0；没有已确认能完整修复上述框架问题的 Astro 5 补丁。后续应安排独立迁移并重新审计，而不是把本次最小处理当作长期终点。[Astro 当前包元数据](https://registry.npmjs.org/astro/latest)、[Astro 6 迁移指南](https://docs.astro.build/en/guides/upgrade-to/v6/)、[Astro 7 迁移指南](https://docs.astro.build/en/guides/upgrade-to/v7/)

迁移需检查以下项目：

1. Astro、MDX 和相关官方包一起升级。当前 MDX 8.1.0 要求 Astro `^7.2.10`；Astro 7.4.0 要求 Node `>=22.22.0`，仓库 CI 的 Node 24 满足要求。[MDX 官方包配置](https://raw.githubusercontent.com/withastro/astro/main/packages/integrations/mdx/package.json)
2. 迁移 Zod 4：`src/utils/error-map.ts` 使用 Zod 3 的 `errorMap`、`SafeParseReturnType`、`unionErrors` 等接口，且配置初始化必经此工具；`src/types/user-config.ts` 的单参数 `z.record` 等也需要更新。内容 schema 改从 `astro/zod` 导入 `z`。
3. 保留现有 remark/rehype 数学、阅读时间、标题与外链插件时，显式安装兼容版本 `@astrojs/markdown-remark` 并使用 `markdown.processor: unified()`；可设置 `compressHTML: true` 保持旧空白处理，避免英文行内文字黏连。检查新的 Rust 编译器、Vite 8、自定义 virtual-config 插件和 Shiki 4 转换器。
4. `@astrojs/tailwind` 6 的 peer 范围只支持 Astro 3/4/5，官方已废弃该集成。若需消除 Tailwind 3 的依赖链，应迁移 Tailwind 4 的官方 Vite 插件，并验证颜色变量、dark class、Typography、自定义 prose、响应式及任意选择器。[Astro Tailwind 说明](https://docs.astro.build/en/guides/integrations-guide/tailwind/)
5. 重新验证空站与真实中英 MDX、英文回退、草稿过滤、数学/代码/图片、分类/标签/归档、分页、内部资源与锚点、双语 Pagefind、RSS/sitemap，以及主题、登录与评论。同步运行新的完整及 production 依赖审计并保留结果；未修复项应继续记录其输入边界与计划。
