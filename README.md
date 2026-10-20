# Cyril Fan 的个人网站

Cyril Fan 的科研个人主页与博客，基于 [Axi404/Axi-Theme](https://github.com/Axi404/Axi-Theme) 定制，使用 Astro 生成静态页面。

正式域名配置为 **[cyril-fan.top](https://cyril-fan.top/)**，公开源码仓库为 **[Cyril-Fan/Cyril-Fan.github.io](https://github.com/Cyril-Fan/Cyril-Fan.github.io)**。域名解析、GitHub Pages 部署和 HTTPS 状态应以控制台与实际访问结果为准。

## 首版内容

- 中文默认页面与英文基础页面：首页、研究、项目、关于、友链。
- 站内搜索、明暗主题、手机适配、分类、标签、RSS 和 GitHub 贡献日历。
- 暂无公开文章、论文、项目或友链时显示空状态；独立访客统计关闭。
- 关于页与文章留言支持已验证邮箱的密码账户，中英文共用讨论。配置与验收见 [COMMENTS-SETUP.md](./COMMENTS-SETUP.md)；未配置后台时显示准备中，不开放提交。

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

`npm ci` 按锁文件安装依赖；`npm test` 执行认证、评论界面与主题回归，`npm run test:database` 在本地 PGlite 中验证数据库迁移和权限，不连接正式评论数据库。`build` 会执行 Astro 检查并生成 `dist/`；搜索索引在生产构建中生成，因此请通过 `preview` 验证站内搜索。

GitHub Actions 在发布前会自动执行 `npm ci`、`npm test`、`npm run test:database` 和 `npm run build`，任一步失败都不会进入部署步骤。

## 写作与维护

日常新增文章、草稿、图片与英文译文的方法见 [CONTENT-GUIDE.md](./CONTENT-GUIDE.md)。

评论数据库迁移位于 `supabase/migrations/`，前端只接收两个公开项目变量，私钥不能提交到仓库。构建依赖的安全范围与后续迁移见 [SECURITY-NOTES.md](./SECURITY-NOTES.md)。

| 内容 | 维护位置 |
| --- | --- |
| 站点名、邮箱、GitHub、域名、导航、集成开关 | `src/site.config.ts` |
| 首页与关于 | `src/pages/index.astro`、`src/pages/about/index.astro` 及 `src/pages/en/` 对应文件 |
| 研究与项目 | `src/pages/academic/`、`src/pages/projects/index.astro` 及英文对应文件 |
| 博客文章 | `src/content/blogs/每篇文章目录/index.mdx` |
| 头像与网站图标 | `src/assets/` 与 `public/` 中配置所引用的资源 |
| 站点规范说明 | `src/pages/terms/` 与 `src/pages/en/terms/` |
| 正式地址、语言、静态构建 | `astro.config.mjs` |
| 自动发布 | `.github/workflows/deploy.yml` |

首页、关于等页面的资料有中英文副本；修改个人信息时请同步检查两种语言。

## GitHub Pages

在公开仓库的 **Settings → Pages → Build and deployment** 中选择 **GitHub Actions**。推送 `main` 分支后，查看 **Actions** 中的部署结果；只有工作流完成且网页可访问，才表示对应版本已发布。

在 Pages 设置中将自定义域名设为 `cyril-fan.top`。项目的 `public/CNAME` 仅记录主域名；使用 Actions 发布时，GitHub 忽略该文件，仍须在 Pages 设置中指定域名。域名 DNS 与 HTTPS 检查通过后启用 **Enforce HTTPS**。`www.cyril-fan.top` 指向同一个 Pages 站点，由 Pages 根据主域名配置处理跳转。DNS 操作与验证见写作维护指南。

## 主题与内容版权

主题源码保留上游的 [Apache-2.0 许可证](./LICENSE)，来源与修改说明见 [THEME-NOTICE.md](./THEME-NOTICE.md)。Cyril Fan 的原创文章、个人资料和自有图片归 Cyril Fan 所有；第三方资源遵循各自许可。公开源码不代表原创内容自动获得开放转载许可。
