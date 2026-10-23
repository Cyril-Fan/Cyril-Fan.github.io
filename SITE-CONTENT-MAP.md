# 网站内容位置地图

这份文件按“我想改什么”整理维护入口。路径都相对于仓库根目录；点击链接可直接在 GitHub 打开。正式网站：[cyril-fan.top](https://cyril-fan.top/)。

## 先记住这几个目录

| 目录 | 放什么 | 修改方式 |
| --- | --- | --- |
| [`src/pages/`](src/pages/) | 页面入口和独立 Markdown 页面 | 中文入口在此；英文入口在 `src/pages/en/` |
| [`src/components/`](src/components/) | 页面实际布局、复用界面与文字 | 很多 `index.astro` 只有一行引用，实际内容在组件里 |
| [`src/content/blogs/`](src/content/blogs/) | 博客正文、文章信息和配图 | 一篇文章一个目录，见[写作指南](CONTENT-GUIDE.md) |
| [`src/assets/`](src/assets/) | 需要构建处理的头像、照片、图标源文件和数据快照 | 图片可由 Astro 生成合适尺寸；快照由脚本更新 |
| [`public/`](public/) | 按原路径发布的资源 | 如 `public/links/axi.webp` 的网址就是 `/links/axi.webp` |
| [`src/lib/`](src/lib/) | 交互、认证、评论、数据校验与刷新逻辑 | 改行为时查看这里，通常不是日常写作入口 |
| [`supabase/`](supabase/) | 评论和访问计数的数据库结构、迁移与部署说明 | SQL 文件是结构版本；真实账户、留言、访问总数在 Supabase |
| [`scripts/`](scripts/) | 头像导入、图标生成、贡献和 RSS 同步、构建检查 | 优先用脚本生成资源，避免手动修改产物 |
| [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) | 测试、更新数据、构建、发布 | 推送 `main` 自动发布，并有每小时计划构建 |

## 个人资料、首页和公共界面

| 想改的内容 | 直接维护的位置 | 注意 |
| --- | --- | --- |
| 网站标题、作者、邮箱、GitHub 用户名、域名、建站日期 | [`src/site.config.ts`](src/site.config.ts) | 英文元信息同时检查 `description_en` / `author_en` |
| 首页简介、学生 / 帅哥彩蛋、教育经历、学校链接 | [`src/components/home/HomePage.astro`](src/components/home/HomePage.astro) | 同一个组件内用 `en` 区分两种语言 |
| 中文 / 英文首页入口 | [`src/pages/index.astro`](src/pages/index.astro)、[`src/pages/en/index.astro`](src/pages/en/index.astro) | 实际界面由 `HomePage.astro` 生成 |
| 主页头像 | [`src/assets/avatar.png`](src/assets/avatar.png) | 首页会生成优化后的响应图片 |
| 评论站长头像、对外提供的本站头像地址 | [`public/avatar/avatar.png`](public/avatar/avatar.png) | 与上面的头像同步更新；不会自动跟随 GitHub 头像变化 |
| 左上角 Cyril Fan、顶部菜单和手机菜单 | [`src/components/basic/Header.astro`](src/components/basic/Header.astro) | 字体与字重也在该组件；中英文导航在这里分别呈现 |
| 页脚署名、站点说明入口、社交链接 | [`src/components/basic/Footer.astro`](src/components/basic/Footer.astro)、[`src/site.config.ts`](src/site.config.ts) 的 `footer` | 四条站点说明的正文不在这里 |
| 全站宽度和页面外壳 | [`src/layouts/BaseLayout.astro`](src/layouts/BaseLayout.astro) | 所有普通页面共用 |
| 正文与右侧目录的两栏布局 | [`src/layouts/ContentLayout.astro`](src/layouts/ContentLayout.astro) | 容器延伸到评论区底部，决定目录何时移出 |
| 目录高亮、滚动进度和章节跳转 | [`src/components/pages/TOC.astro`](src/components/pages/TOC.astro) | 章节条目由各页面的 `headings` 提供，用户评论里的标题不进入目录 |
| 明暗主题 | [`src/components/basic/ThemeProvider.astro`](src/components/basic/ThemeProvider.astro)、[`src/utils/theme.ts`](src/utils/theme.ts) | 保留跟随系统与手动选择 |
| 全局颜色、字体、Markdown 排版 | [`src/assets/styles/app.css`](src/assets/styles/app.css)、[`public/styles/global.css`](public/styles/global.css) | 页面局部样式优先写在对应组件，避免全站误伤 |
| SEO、分享卡片、canonical、RSS 发现链接 | [`src/components/BaseHead.astro`](src/components/BaseHead.astro) | 正式域名和语言路由还在 `astro.config.mjs` |

## 关于、学术、博客和站点说明

| 内容 | 中文 | 英文 / 补充 |
| --- | --- | --- |
| 关于：自我介绍、研究兴趣、联系方式和目录条目 | [`src/pages/about/index.astro`](src/pages/about/index.astro) | [`src/pages/en/about/index.astro`](src/pages/en/about/index.astro) |
| 关于页湖畔照片 | [`src/assets/photos/cyril-fan-lakeside.webp`](src/assets/photos/cyril-fan-lakeside.webp) | [`src/components/about/AboutPhoto.astro`](src/components/about/AboutPhoto.astro) 控制两种语言的大小、对齐与替代文字 |
| 学术页面 | [`src/pages/academic/index.astro`](src/pages/academic/index.astro) | [`src/pages/en/academic/index.astro`](src/pages/en/academic/index.astro) |
| 项目页面 | [`src/pages/projects/index.astro`](src/pages/projects/index.astro) | [`src/pages/en/projects/index.astro`](src/pages/en/projects/index.astro) |
| 文章正文 | `src/content/blogs/<文章目录>/index.mdx` 或 `index.md` | 可选 `index-en.mdx`；配图放同目录，使用相对路径 |
| 文章标题、摘要、日期、分类、标签、草稿和评论开关 | 文章最上方的 frontmatter | 修改正文后如需更新展示日期，要同时改 `updatedDate` |
| 博客列表与分类 | [`src/pages/blog/[category]/[...page].astro`](src/pages/blog/[category]/[...page].astro) | 对应英文文件位于 `src/pages/en/blog/`；“全部文章”与虚线等展示由相关博客组件控制 |
| 文章详情 | [`src/pages/blog/[...id].astro`](src/pages/blog/[...id].astro) | [`src/layouts/BlogPost.astro`](src/layouts/BlogPost.astro) 和详情组件控制排版 |
| 标签 / 归档 / 集合 | [`src/pages/tags/`](src/pages/tags/)、[`src/pages/archives/`](src/pages/archives/)、[`src/pages/collection/`](src/pages/collection/) | 中英文对应；列表按文章集合自动生成 |
| 搜索页面 | [`src/pages/search/index.astro`](src/pages/search/index.astro) | 构建时由 [`src/axi-integration.ts`](src/axi-integration.ts) 生成 Pagefind 索引 |
| 站点说明的四个条目 | [`src/site.config.ts`](src/site.config.ts) 中 `terms` / `englishTerms` | 列表界面：`src/pages/terms/list.astro` 与英文对应页；条目悬停：[`CardListChildren.astro`](src/components/user/CardListChildren.astro) |
| 隐私 / 使用 / 版权 / 内容说明正文 | [`src/pages/terms/`](src/pages/terms/) 的四个 `.md` 文件 | [`src/pages/en/terms/`](src/pages/en/terms/) 中同步维护翻译 |

新增文章、图片、英文翻译、分类值和草稿注意事项，详见 [CONTENT-GUIDE.md](CONTENT-GUIDE.md)。草稿提交到这个公开 GitHub 仓库后，**源码仍然公开**。

## 友链与朋友圈

| 内容 | 位置 |
| --- | --- |
| 友链名称、简介、网址、头像路径、RSS | [`public/links.json`](public/links.json) |
| 稳定字典序规则 | [`src/lib/friends.ts`](src/lib/friends.ts) |
| 头像文件 | [`public/links/`](public/links/)，统一为小写文件名 `.webp` |
| 友链卡片外观 | [`src/components/links/FriendList.astro`](src/components/links/FriendList.astro) |
| 四个板块及目录、评论区挂载 | [`src/components/links/LinksPage.astro`](src/components/links/LinksPage.astro) |
| 本站 Name / Desc / Link / Avatar / RSS、复制按钮、申请说明 | [`src/components/links/LinkExchange.astro`](src/components/links/LinkExchange.astro)；Desc 为 `Cosmic style` |
| 朋友圈、随机阅读、作者文章弹窗、分页 | [`src/components/links/FriendFeed.astro`](src/components/links/FriendFeed.astro) |
| RSS / Atom 获取与过滤 | [`scripts/friend-feeds.mjs`](scripts/friend-feeds.mjs)、[`scripts/sync-friend-feeds.mjs`](scripts/sync-friend-feeds.mjs) |
| 构建使用的订阅快照 | [`src/assets/friend-feeds.json`](src/assets/friend-feeds.json)，由 `npm run sync:friends` 更新 |
| 朋友圈后台更新检测 | [`src/lib/friend-feed-refresh.ts`](src/lib/friend-feed-refresh.ts)，读取 [`public/data/friend-feeds.json`](public/data/friend-feeds.json) |

添加朋友时，在 `public/links.json` 中增加一条记录即可；不用自己打乱或手工维护显示顺序。`feed` 不是网站主页地址，而是 RSS / Atom 地址。Roy Zhao 的订阅是 `https://royzhao.cn/rss.xml`。没有可用订阅或订阅暂时没有文章时，卡片仍会显示，但朋友圈没有该站文章。

导入头像：

```sh
npm run avatar:friend -- "C:/path/to/original-photo.jpg" friend-name
```

脚本会自动旋转照片、缩小至最长边不超过 320 像素、输出 WebP 并移除元数据；小图片不会强行放大。之后将 `avatar` 填为 `/links/friend-name.webp`。已有合适 WebP 不需要重新压缩。原始照片留在自己的本地相册，仓库只维护网站使用的优化文件。

## 图标、贡献图和统计数据

| 内容 | 位置 / 真正的数据源 |
| --- | --- |
| 网站透明星宇图标的源文件 | [`src/assets/brand/star-orbit.svg`](src/assets/brand/star-orbit.svg) |
| 生成 favicon / Apple 图标 / manifest 和兼容入口 | [`scripts/branding.mjs`](scripts/branding.mjs)、[`scripts/generate-branding.mjs`](scripts/generate-branding.mjs) |
| 所有页面统一图标声明 | [`src/components/SiteIcons.astro`](src/components/SiteIcons.astro) |
| 图标生成清单 | `src/assets/brand/generated-*.json`；属于构建产物，不手动维护 |
| GitHub 日历与浅 / 深色原版蛇图来源 | [Cyril-Fan/Cyril-Fan 的 assets 目录](https://github.com/Cyril-Fan/Cyril-Fan/tree/main/assets)；生成任务在该资料仓库 |
| 贡献数据读取与一致性、安全校验 | [`src/lib/contribution-feed.ts`](src/lib/contribution-feed.ts)、[`src/lib/github-contributions.ts`](src/lib/github-contributions.ts) |
| 贡献数据构建同步 | [`scripts/sync-contribution-snake.mjs`](scripts/sync-contribution-snake.mjs)、[`scripts/sync-contribution-calendar.mjs`](scripts/sync-contribution-calendar.mjs) |
| 已校验的贡献快照 | `src/assets/contributions.json`、`src/assets/contribution-calendar.json`、`public/contributions/` |
| 浏览器与后续构建共用的完整贡献快照 | [`public/data/contributions.json`](public/data/contributions.json)，由同步脚本生成，不手动编辑 |
| 贡献图展示、动画开关、日期查询、前台刷新 | [`ContributionSnake.astro`](src/components/home/ContributionSnake.astro)、[`src/lib/contribution-view.ts`](src/lib/contribution-view.ts) |
| 建站天数、最近文章日期、字数、文章数 | [`src/components/home/BlogStats.astro`](src/components/home/BlogStats.astro)；建站日期在 `src/site.config.ts` |
| 建站天数的上海日期计算及跨日刷新 | [`src/lib/site-days.ts`](src/lib/site-days.ts) |
| 主页底部的访问次数文字与位置 | [`src/components/home/SiteVisits.astro`](src/components/home/SiteVisits.astro)，由 `HomePage.astro` 引入 |
| 全站访问次数请求、重试与只读刷新 | [`src/lib/site-traffic.ts`](src/lib/site-traffic.ts)，由 `BaseLayout.astro` 加载 |
| 访问次数的真实总数 | **Supabase** 的 `site_private.traffic`，不是 GitHub 文件；结构见 [`202610230008_site_page_views.sql`](supabase/migrations/202610230008_site_page_views.sql) |

图标请只改源文件和生成规则，避免只替换某一个 favicon。老浏览器的历史图标缓存独立于网页缓存，网页无法替用户强制清空它。

统计起点和累计访问次数不会因推送代码、重新部署、切换语言而重置。公开接口只能读取总数或为一次页面打开加 1，不能指定任意总数。内部计数表和短期请求去重记录不对浏览器开放。

## 动态数据多久更新

| 数据 | 当前更新方式 | 注意 |
| --- | --- | --- |
| 贡献日历、蛇图、贡献总数 | 首页可见时每 5 分钟检查资料仓库；GitHub 不可用时读取本站完整快照；网站每小时尝试构建快照 | 资料仓库也需要先完成生成，GitHub 任务可能排队；超过 36 小时会显示延迟提示，日历和两套蛇图不会混用不同版本 |
| 朋友圈文章 | 每次构建抓取 RSS / Atom，每小时尝试自动构建 | 源站和 GitHub 计划任务都可能延迟；抓取失败按每个源的最近成功内容保留，不把失败时间写成成功时间 |
| 长时间打开的朋友圈 | 可见页面每 10 分钟检查本站 JSON | 只有文章内容变化才提示，点击后在新标签页查看；不打断原页草稿、分页和弹窗 |
| 评论、昵称、头像 | 页面进入或手动刷新从 Supabase 读取；评论区可见时每分钟检查前 30 条是否变化 | 变化后提示刷新；分页中更深的旧留言需手动刷新后重读，不自动覆盖输入 |
| 全站访问次数 | 页面打开、刷新或历史返回后可见时加 1；主页显示每分钟读取最新总数 | 新请求重试不重复计数，不等于独立人数；禁用脚本、拦截或异常流量限频会影响结果 |
| 建站天数 | 按上海日期，每分钟及返回页面时重算 | 跨午夜无需等待重新部署 |
| 文章数量、字数、最近文章日期、搜索、本站 RSS、站点地图 | 发布内容后重新构建生成 | 推送 `main` 会触发发布；必须等待 Actions 成功 |
| 站长头像、友链头像、个人简介和友链清单 | 修改本仓库对应文件并发布 | 不会自动跟随 GitHub 头像或朋友站点的修改 |

“每小时 / 每 5 分钟”是检查计划，不是即时同步承诺；上游数据、任务队列和 CDN 缓存都可能增加延迟。同步失败保留真实旧记录及原日期，不伪装成最新数据。

## 评论、账户和邮件

| 内容 | 位置 |
| --- | --- |
| 评论界面和样式 | [`src/components/advanced/Comment.astro`](src/components/advanced/Comment.astro) |
| 回复、列表、删除、昵称、头像、站长菜单交互 | [`src/lib/comments.ts`](src/lib/comments.ts) |
| 注册 / 登录 / 找回密码界面 | [`src/components/advanced/CommentAuth.astro`](src/components/advanced/CommentAuth.astro) |
| 认证逻辑、会话和密码最低长度 | [`src/lib/comment-auth.ts`](src/lib/comment-auth.ts)；后台策略同时在 Supabase Auth 设置中 |
| 邮箱确认 / 重置密码页面 | [`src/components/advanced/AuthConfirmPage.astro`](src/components/advanced/AuthConfirmPage.astro)，入口为 `/auth/confirm` 与 `/en/auth/confirm` |
| Markdown 与公式安全渲染 | [`src/lib/comment-markdown.ts`](src/lib/comment-markdown.ts) |
| 用户上传头像的裁剪和校验 | [`src/lib/comment-avatar.ts`](src/lib/comment-avatar.ts) |
| 评论线程地址 / 文本规则 | [`src/lib/comment-utils.ts`](src/lib/comment-utils.ts) |
| 评论、昵称、管理员、禁言、权限函数 | **Supabase** 的 `comment_private` schema；结构版本在 [`supabase/migrations/`](supabase/migrations/) |
| 用户邮箱与密码认证信息 | **Supabase Auth**；不在 GitHub 仓库，公开留言接口不返回邮箱 |
| 普通用户上传的头像 | **Supabase Storage**；与 `public/links/` 中的友链头像是两回事 |
| 验证邮件、找回密码邮件 | Supabase Auth + Resend SMTP；部署方法见 [`COMMENTS-SETUP.md`](COMMENTS-SETUP.md) 和 [`supabase/README.md`](supabase/README.md) |

中英文 About 共用 `/about` 讨论，中英文友链共用 `/links` 讨论。文章线程按文章地址规范化。不要通过改前端按钮来修改权限：权限必须由数据库函数执行。

## 发布、配置和测试

- [`astro.config.mjs`](astro.config.mjs)：正式地址、语言路由、构建插件、旧地址跳转。
- [`public/CNAME`](public/CNAME)：GitHub Pages 自定义域名。DNS 记录在阿里云，不在这个仓库。
- [`.env.example`](.env.example)：允许进入静态站的两个公开 Supabase 配置变量的格式。本地实际值在被 Git 忽略的 `.env`；正式值在 GitHub Actions 仓库 Variables。
- [`package.json`](package.json) / [`package-lock.json`](package-lock.json)：命令、依赖及精确安装版本。
- [`tests/`](tests/)：前端逻辑回归；[`tests/database/`](tests/database/)：本地临时 PostgreSQL 权限测试，不连接正式数据库。
- [`scripts/verify-site-output.mjs`](scripts/verify-site-output.mjs)：检查每个生成页面的图标、导航与基本安全元信息。
- `dist/`、`.astro/`、`node_modules/`：本地生成文件或依赖，**不要在里面改网站内容，也不要提交**。

数据库密码、service_role 密钥、Resend 密钥、SMTP 密码不应进入任何 GitHub 文件。数据库迁移提交到 GitHub **不会自动执行到正式 Supabase**；需要按 `supabase/README.md` 单独部署。

源代码里还保留了主题提供的部分未启用组件，例如旧的 `GitHubActivityCalendar.astro`、`Substats.astro`。修改前先确认当前页面是否实际引用；以本地图和页面入口为准。
