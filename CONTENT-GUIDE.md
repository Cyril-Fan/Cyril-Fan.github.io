# 写作与维护指南

日常写作现在可以直接使用 [内容后台](https://cyril-fan.top/admin/)，参见 [后台操作指南](CMS-GUIDE.md)。私有草稿、图片和历史记录存放在 Supabase，点发布后才生成公开 Markdown 并自动构建。

以下为代码维护和原有 Markdown / MDX 工作流参考。后台管理的文章不要同时手工修改生成文件；后台检测到外部冲突会停止发布。提交到公开仓库的传统 `draft: true` 文件依然公开，不能代替后台的私有草稿。

## 新增一篇文章

在 `src/content/blogs/` 下新建一个简短的英文目录，例如 `my-first-note/`，再创建 `index.mdx`（普通 Markdown 也可用 `index.md`）。目录名用于文章地址，发布后尽量不要改动。

```text
src/content/blogs/my-first-note/
├── index.mdx
├── index-en.mdx       # 可选英文译文
└── experiment.png    # 可选配图
```

`index.mdx` 最小示例：

```md
---
title: '一篇笔记的标题'
description: '用一句话概括这篇文章。'
publishDate: '2026-10-18'
category: 'tech'
tags: ['python', 'notes']
language: '中文'
draft: true
comment: false
---

在这里写正文。

## 小节

行内公式：$y = f(x)$。

![实验示意图](./experiment.png)
```

使用示例图片语句前，先把自己的图片放入同一目录；没有图片时删掉该行。`title` 最多 60 个字符，`description` 最多 160 个字符；这两项和 `publishDate` 为必填。可用 `updatedDate: '2026-10-19'` 记录后续更新。

## 分类与标签

为每篇文章选择下列一种 `category`，确保它进入相应分类列表：

| category | 用途 |
| --- | --- |
| `research` | 论文阅读、研究笔记、实验方法 |
| `tech` | 编程与技术实践 |
| `daily` | 日常记录 |

`tags` 可填多个词，系统会转为小写并去重。未发布文章时，分类和标签页面显示空状态。月记栏目已移除；旧 `journal` / `month-journal` 分类归入 `daily`，旧入口跳转到日常，不影响文章内容。

## 草稿与公开范围

`draft: true` 的文章可在 `npm run dev` 中预览，生产构建会排除。完成后改成 `draft: false` 再发布。`publishDate` 是展示日期，不是定时发布开关；未来日期的文章也应通过 `draft` 控制是否上线。

**这个仓库是公开仓库，草稿文件一旦提交，源码仍然公开。** 未公开研究、账号密钥和其他私人内容应保留在仓库之外。删除文件也不会自动删除 Git 提交历史。

## 英文与图片

可在同一目录添加 `index-en.mdx`，沿用相同的 frontmatter 字段，将标题、摘要、正文和 `language` 改为英文，并保持相同分类。没有英文译文时，英文博客入口会回落显示中文原文；不需要为每篇文章强制翻译。

正文图片优先使用同目录相对路径，例如 `![说明](./experiment.png)`。封面图可在 frontmatter 增加：

```yaml
heroImage:
  src: './experiment.png'
  alt: '实验结果的简短说明'
```

仅上传有权发布的图片。图片适当压缩并写清 `alt`，不要上传包含私人信息的截图。`public/` 资源使用 `/images/example.png` 这类站点根路径，不要写本机磁盘路径。

## 本地验证与发布

1. 首次运行 `npm install`，日常用 `npm run dev` 预览。
2. 准备发布时运行 `npm run build`，再用 `npm run preview` 检查正式构建，包括搜索、链接、手机宽度和中英文切换。
3. 提交修改并推送到 `Cyril-Fan/Cyril-Fan.github.io` 的 `main` 分支。
4. 在 GitHub **Actions** 查看 `.github/workflows/deploy.yml` 的运行结果；失败时先读日志再修复。
5. 部署完成后实际打开正式域名检查。GitHub 贡献日历反映构建时取得的数据，后续更新可重新运行部署。

文章发布后会进入分类、标签、搜索索引与 RSS；无需手工维护文章列表。配置 Supabase 后，非草稿文章默认显示留言区，`comment: false` 可关闭单篇留言入口。中英文对应文章按同一个目录 ID 共用讨论；发布后不要随意改文章目录名，否则会变成新的讨论地址。评论服务配置见 [COMMENTS-SETUP.md](./COMMENTS-SETUP.md)。

## 修改个人信息

- `src/site.config.ts`：站点名称、简介元信息、邮箱、GitHub、域名、头像路径、导航和搜索等开关。
- GitHub Actions repository variables `PUBLIC_SUPABASE_URL` 与 `PUBLIC_SUPABASE_ANON_KEY`：评论服务的公开连接配置；本地开发放到不提交的 `.env.local`。
- `src/pages/index.astro` 与 `src/pages/en/index.astro`：首页介绍。
- `src/pages/about/index.astro` 与 `src/pages/en/about/index.astro`：详细个人介绍。
- `src/pages/academic/` 与 `src/pages/en/academic/`：研究与论文展示。
- `src/pages/projects/index.astro` 与 `src/pages/en/projects/index.astro`：项目展示。
- `src/pages/links/index.astro` 与 `src/pages/en/links/index.astro`：友链。
- `src/pages/terms/` 与 `src/pages/en/terms/`：网站使用、版权与隐私说明；新增外部服务时应同步核对实际行为。

首版公开资料为 Cyril Fan，吉林大学软件工程本科生，关注深度学习、多模态大语言模型与 AI Agents，邮箱 `1943480241@qq.com`，GitHub `Cyril-Fan`。暂无公开成果时保留空状态，后续再补充真实内容。

## 域名与 DNS

域名在阿里云管理，网站由 GitHub Pages 托管。按 GitHub 官方文档配置 DNS；如已有邮件或其他服务记录，先核对用途再修改。

- GitHub **Settings → Pages**：发布来源选 **GitHub Actions**，主域名填 `cyril-fan.top`。
- 根域 `@`：使用 GitHub Pages 官方列出的 A 记录；若添加 AAAA，采用同一官方文档中的 IPv6 地址。
- `www`：添加 CNAME，目标为 `cyril-fan.github.io`，不要填写协议或仓库路径。
- `astro.config.mjs` 中的站点地址应与主域名一致。`public/CNAME` 仅记录主域名；使用 Actions 发布时 GitHub 会忽略它，自定义域名须通过 Pages 设置配置。
- 建议按 GitHub 提示添加域名所有权验证 TXT 记录。等待 DNS 检查和证书就绪后，启用 **Enforce HTTPS**。
- 验证 `https://cyril-fan.top` 可访问，并检查 `https://www.cyril-fan.top` 跳转到根域。DNS 记录存在不代表 HTTPS 与跳转已经成功。

DNS 目标地址以 [GitHub Pages 自定义域名配置文档](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site) 为准。故障排查可参考 [GitHub Pages 自定义域名排错](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/troubleshooting-custom-domains-and-github-pages)。

