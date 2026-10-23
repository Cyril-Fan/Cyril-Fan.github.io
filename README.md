# Cyril Fan 的个人网站

Cyril Fan 的科研个人主页与博客，基于 [Axi404/Axi-Theme](https://github.com/Axi404/Axi-Theme) 定制，使用 Astro 7 和 Tailwind 4 生成静态页面。

正式域名配置为 **[cyril-fan.top](https://cyril-fan.top/)**，公开源码仓库为 **[Cyril-Fan/Cyril-Fan.github.io](https://github.com/Cyril-Fan/Cyril-Fan.github.io)**。域名解析、GitHub Pages 部署和 HTTPS 状态应以控制台与实际访问结果为准。

## 首版内容

- 中文默认页面与英文基础页面：首页、研究、项目、关于、友链。
- 站内搜索、明暗主题、手机适配、分类、标签、RSS，以及与 GitHub 主页同步的浅／深色贡献蛇动画。关闭动画后切换为同尺寸的真实贡献日历，支持悬停、点击、键盘及日期查询。
- 暂无公开文章、论文、项目或友链时显示空状态；独立访客统计关闭。
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

`npm ci` 按锁文件安装依赖；`npm test` 执行认证、评论、Markdown、主题、图标、目录与贡献图回归；`npm run test:database` 在本地 PGlite 中验证权限，不连接正式数据库。`build` 获取一份 GitHub 贡献数据，同时生成每日静态日历与浅色／深色蛇动画，再执行 Astro 检查、生成统一图标和 `dist/`，逐页校验后生成搜索索引。请通过 `preview` 验证站内搜索。

CI 使用工作流自带的短期 `GITHUB_TOKEN` 查询 GitHub GraphQL；本地无 token 时读取本人 GitHub 资料仓库中带时间戳的公开快照。数据不新鲜、抓取失败或两种图表不一致时停止构建，保留已在线的成功版本，不用仓库里的旧快照覆盖它。工作流每小时尝试同步，GitHub 的数据与任务队列都可能延迟；页面展示数据截至日期及获取时间。蛇路线由本站独立实现，检查正交移动、不自交、蛇头到达时吃格及循环闭合。

修改框架或文章处理插件后，可运行 `npm run test:content`：用临时中英文文章检查 MDX、公式、代码、图片、回退页面、草稿、搜索与 RSS，完成后移除临时内容，产物位于忽略提交的 `.content-check-dist/`。检查时不要同时编辑对应的 `migration-*` 临时内容目录。执行 `npm audit` 检查完整依赖树，生产依赖可另运行 `npm audit --omit=dev`。

GitHub Actions 在发布前会自动执行 `npm ci`、`npm test`、`npm run test:database` 和 `npm run build`，任一步失败都不会进入部署步骤。

## 写作与维护

日常新增文章、草稿、图片与英文译文的方法见 [CONTENT-GUIDE.md](./CONTENT-GUIDE.md)。

评论数据库迁移位于 `supabase/migrations/`，前端只接收两个公开项目变量，私钥不能提交到仓库。依赖迁移、安全边界及验收记录见 [SECURITY-NOTES.md](./SECURITY-NOTES.md)。

| 内容 | 维护位置 |
| --- | --- |
| 站点名、邮箱、GitHub、域名、导航、集成开关 | `src/site.config.ts` |
| 双语首页与关于 | `src/components/home/HomePage.astro`、`src/pages/about/index.astro` 与英文对应文件 |
| 研究与项目 | `src/pages/academic/`、`src/pages/projects/index.astro` 及英文对应文件 |
| 博客文章 | `src/content/blogs/每篇文章目录/index.mdx` |
| 主页头像 | `src/assets/avatar.png` 与 `public/avatar/avatar.png` |
| 关于页照片 | `src/assets/photos/cyril-fan-lakeside.webp`，`AboutPhoto.astro` 负责两种语言的响应图片 |
| 统一网站图标 | `src/assets/brand/star-orbit.svg`；构建生成 PNG、ICO、Safari 图标、manifest 与备用路径，版本包含矢量及渲染参数；修改生成规则时同步更新 `iconRecipe.version` |
| 贡献图 | `scripts/sync-contribution-snake.mjs` 获取同一数据并生成整套资源，`sync-contribution-calendar.mjs` 核验整套资源，`contribution-animation.mjs` 生成连续蛇路线，`ContributionSnake.astro` 控制主题、动画/日历切换与查询 |
| 站点规范说明 | `src/pages/terms/` 与 `src/pages/en/terms/` |
| 正式地址、语言、静态构建 | `astro.config.mjs` |
| 自动发布 | `.github/workflows/deploy.yml` |

首页、关于等页面的资料有中英文副本；修改个人信息时请同步检查两种语言。

## GitHub Pages

在公开仓库的 **Settings → Pages → Build and deployment** 中选择 **GitHub Actions**。推送 `main` 分支后，查看 **Actions** 中的部署结果；只有工作流完成且网页可访问，才表示对应版本已发布。

在 Pages 设置中将自定义域名设为 `cyril-fan.top`。项目的 `public/CNAME` 仅记录主域名；使用 Actions 发布时，GitHub 忽略该文件，仍须在 Pages 设置中指定域名。域名 DNS 与 HTTPS 检查通过后启用 **Enforce HTTPS**。`www.cyril-fan.top` 指向同一个 Pages 站点，由 Pages 根据主域名配置处理跳转。DNS 操作与验证见写作维护指南。

## 主题与内容版权

主题源码保留上游的 [Apache-2.0 许可证](./LICENSE)，来源与修改说明见 [THEME-NOTICE.md](./THEME-NOTICE.md)。Cyril Fan 的原创文章、个人资料和自有图片归 Cyril Fan 所有；第三方资源遵循各自许可。公开源码不代表原创内容自动获得开放转载许可。
