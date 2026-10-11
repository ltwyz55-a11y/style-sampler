# 画风采样器

公开网址：[https://ltwyz55-a11y.github.io/style-sampler/](https://ltwyz55-a11y.github.io/style-sampler/)

前端由 GitHub Pages 托管；分析服务使用 Cloudflare Workers 免费方案调用 Google Gemini API。访客无需登录。分析每次最多发送 8 张浏览器压缩后的参考图，生成中英文风格报告、提示词和模板。

## 图片和服务额度

- 每组 2–8 张；支持 PNG、JPG、WebP、GIF。图片在浏览器压缩后发送，单张最多 768 KB、整组最多 6 MB。
- 每次分析前，访客需确认图片会发送给 Google Gemini 免费层。Google 可能使用免费层提交内容改进产品。本站和 Worker 不保存图片或分析结果；Cloudflare 仅保留用于限流的哈希来源标识及一小时内的请求时间，过期记录会清除。
- 每个来源 IP 每滚动一小时最多 5 次有效分析提交，模型错误也计入次数。第 6 次请求收到 429 和重试时间。
- Gemini 与 Cloudflare 免费配额有限；配额或服务不可用时，分析暂停并显示提示，不设置付费回退。

## 部署分析接口

请按 [`cloudflare/README.md`](cloudflare/README.md) 部署 Worker 并设置 `GEMINI_API_KEY` Secret。之后，在 GitHub 仓库 Actions Variables 中配置 `ANALYSIS_API_URL` 为 Worker HTTPS origin，并运行 Pages 工作流。密钥不得写入仓库或网页配置。

## 本地前端与 Node 服务器

需要 Node.js 20 或更新版本。`npm start` 可启动原有 Node/OpenAI 本地开发服务器；线上公开 Gemini 分析服务走 `cloudflare/worker.js`。直接以 `file://` 打开 `public/index.html` 时只能预览、查看示例；在线模型分析需要 API 服务地址。

## Pages 发布

推送到 `main` 后，`.github/workflows/pages.yml` 自动构建并发布前端。`ANALYSIS_API_URL` 是公开 API 路由配置，不是密钥；没有该变量时，页面显示分析服务未连接。
