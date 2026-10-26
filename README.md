# Cyril Fan 的个人网站

Cyril Fan 的科研个人主页与博客，基于 [Axi404/Axi-Theme](https://github.com/Axi404/Axi-Theme) 定制，使用 Astro 7 和 Tailwind 4 生成静态页面。

正式域名配置为 **[cyril-fan.top](https://cyril-fan.top/)**，公开源码仓库为 **[Cyril-Fan/Cyril-Fan.github.io](https://github.com/Cyril-Fan/Cyril-Fan.github.io)**。域名解析、GitHub Pages 部署和 HTTPS 状态应以控制台与实际访问结果为准。

**日常内容可以直接在 [站长后台](https://cyril-fan.top/admin/) 编辑并发布。** 使用现有站长账号，支持文章、友链、双语个人资料、学术项目和图片库；提供浏览器本地暂存与恢复、原文件对比、选择文件发布、图片引用检查及 Git 历史恢复。操作见 [CMS-GUIDE.md](CMS-GUIDE.md)，源码位置见 [网站内容位置地图](SITE-CONTENT-MAP.md)。

## 首版内容

- 中文默认页面与英文基础页面：首页、研究、项目、关于、友链。
- 站内搜索、明暗主题、手机适配、分类、标签、RSS，以及与 GitHub 主页同步的浅／深色贡献蛇动画。关闭动画后切换为同尺寸的真实贡献日历，支持悬停、点击、键盘及日期查询。
- 暂无公开文章、论文、项目或友链时显示空状态；主页底部展示匿名全站访问次数（PV），不按独立人数追踪。
- 关于页与文章留言支持已验证邮箱的密码账户，中英文共用讨论，支持 CommonMark、GFM、公式与发布前预览。原始 HTML 按文本显示，外部图片经点击后加载。配置与验收见 [COMMENTS-SETUP.md](./COMMENTS-SETUP.md)。

## 本地开发

安装 Node.js 24 与 npm，在项目目录运行：

```sh
npm ci
npm run dev
```

浏览器打开终端提示的本地地址。提交前运行：

```sh
npm test
npm run test:database
npm run build
npm run preview
```

`npm ci` 按锁文件安装依赖；`npm test` 执行认证、评论、Markdown、主题、图标、目录与贡献图回归；`npm run test:database` 在本地 PGlite 中验证权限，不连接正式数据库。`build` 读取本人 GitHub 资料仓库同一提交的日历和两套原版蛇动画，校验通过后生成静态日历，再执行 Astro 检查、生成统一图标和 `dist/`，逐页校验后生成搜索索引。请通过 `preview` 验证站内搜索。

构建与浏览器共用 `contribution-feed.ts`：先读取 `Cyril-Fan/Cyril-Fan` 的 main 提交号，再按这个固定提交获取日历、浅色 SVG 和深色 SVG。若匿名提交查询被限流，则读取 main 的公开文件，仍须通过整包校验；此时 sourceCommit 为 null，不伪造提交号。校验日历连续性、总数、时间、资料仓库的 `snake_calendar_hash`、每个 SVG 格子的坐标与实际颜色等级（包括原版 base36 字母编号 ca、cb 等）。直接保留 GitHub 主页的原版 Platane/snk 动画，不再使用本站自写寻路。资料工作流生成到一半、读取失败或文件不一致时，不替换完整版本。

网站工作流每小时尝试更新构建快照。浏览器在首页可见时另检查最新资料提交，每个页面最多每 5 分钟一次；两个新图解码完成后，才同时更新动画、日历和总数。GitHub 不可用时会读取本站最新发布的完整快照；构建也优先恢复线上较新的整包，再尝试 GitHub。失败不会伪造更新日期或把新版本换回旧版本，超过 36 小时会提示延迟，不影响静态日历查询。浏览器请求不带本站登录凭据或页面地址，CI 的短期 token 只发给 GitHub API。GitHub 数据、任务队列和 CDN 仍可能延迟；悬停贡献总数可查看数据日期及 24 小时制更新时间。

修改框架或文章处理插件后，可运行 `npm run test:content`：用临时中英文文章检查 MDX、公式、代码、图片、回退页面、草稿、搜索与 RSS，完成后移除临时内容，产物位于忽略提交的 `.content-check-dist/`。检查时不要同时编辑对应的 `migration-*` 临时内容目录。执行 `npm audit` 检查完整依赖树，生产依赖可另运行 `npm audit --omit=dev`。

GitHub Actions 在发布前会自动执行 `npm ci`、`npm test`、`npm run test:database` 和 `npm run build`，任一步失败都不会进入部署步骤。

## 写作与维护

日常新增文章、草稿、图片与英文译文的方法见 [CONTENT-GUIDE.md](./CONTENT-GUIDE.md)。

评论数据库迁移位于 `supabase/migrations/`，前端只接收两个公开项目变量，私钥不能提交到仓库。依赖迁移、安全边界及验收记录见 [SECURITY-NOTES.md](./SECURITY-NOTES.md)。

| 内容 | 维护位置 |
| --- | --- |
| 站点名、邮箱、GitHub、域名、导航、集成开关 | `src/site.config.ts` |
| 双语首页与关于 | 后台“首页与关于”；发布为 `src/data/profile.json` |
| 研究与项目 | 后台“学术与项目”；直接编辑 src/data/academic.json，复用 Axi 论文与项目组件 |
| 博客文章 | 后台“文章”；发布为 `src/content/blogs/<slug>/index.md` 和可选 `index-en.md` |
| 主页与评论站长头像 | 后台“首页与关于”；空值沿用 `src/assets/avatar.png` 与 `public/avatar/avatar.png` |
| 关于页照片 | 后台“首页与关于”的照片字段；空值隐藏照片，替换通过图片库同步引用 |
| 友链与朋友圈 | 后台“友链”生成 `public/links.json`；按名称字典序显示。RSS 快照每次构建刷新，失败时保留每个源最近成功内容 |
| 新图片 | 浏览器本地暂存；发布为 public/media/image-内容指纹.webp 等文件 |
| 统一网站图标 | `src/assets/brand/star-orbit.svg`；构建生成 PNG、ICO、Safari 图标、manifest 与备用路径，并同步所有已发布图标目录；版本包含矢量及渲染参数；修改生成规则时同步更新 `iconRecipe.version` |
| 贡献图 | `src/lib/contribution-feed.ts` 读取并校验原版日历和动画；`scripts/sync-contribution-snake.mjs` 保存构建快照；`ContributionSnake.astro` 与 `contribution-view.ts` 控制刷新、主题、动画/日历切换与查询 |
| 站点规范说明 | `src/pages/terms/` 与 `src/pages/en/terms/` |
| 正式地址、语言、静态构建 | `astro.config.mjs` |
| 自动发布 | `.github/workflows/deploy.yml` |

首页、关于等页面的资料有中英文副本；修改个人信息时请同步检查两种语言。

友链页由 `LinksPage.astro` 共用双语布局，包括本站资料复制、申请模板、朋友圈随机阅读 / 分页 / 作者文章与留言。友链申请在留言区由站长查看后通过后台添加，不会自动把访客提交的 URL 变成订阅抓取目标。朋友圈只展示文章标题、作者、日期及原文链接，每个来源最多保留 40 篇；没有 RSS 或暂时没有文章的朋友仍正常出现在友链卡片中。

页面长时间打开时，朋友圈每 10 分钟检查本站快照，文章变化后提示在新标签页查看；可见的评论区每分钟检查列表变化，只提示刷新，不覆盖草稿。建站天数按上海日期每分钟更新。全站 PV 由独立匿名请求写入 Supabase，主页总数每分钟刷新；本地预览不计数。完整更新频率及局限见[内容位置地图](SITE-CONTENT-MAP.md#动态数据多久更新)。

## GitHub Pages

在公开仓库的 **Settings → Pages → Build and deployment** 中选择 **GitHub Actions**。推送 `main` 分支后，查看 **Actions** 中的部署结果；只有工作流完成且网页可访问，才表示对应版本已发布。

在 Pages 设置中将自定义域名设为 `cyril-fan.top`。项目的 `public/CNAME` 仅记录主域名；使用 Actions 发布时，GitHub 忽略该文件，仍须在 Pages 设置中指定域名。域名 DNS 与 HTTPS 检查通过后启用 **Enforce HTTPS**。`www.cyril-fan.top` 指向同一个 Pages 站点，由 Pages 根据主域名配置处理跳转。DNS 操作与验证见写作维护指南。

## 主题与内容版权

主题源码保留上游的 [Apache-2.0 许可证](./LICENSE)，来源与修改说明见 [THEME-NOTICE.md](./THEME-NOTICE.md)。Cyril Fan 的原创文章、个人资料和自有图片归 Cyril Fan 所有；第三方资源遵循各自许可。公开源码不代表原创内容自动获得开放转载许可。
