# Weave 公众号内容工作台

本地 Web 应用：输入主题或素材，生成文章草稿，编辑内容、切换 40 套模板，并复制微信兼容的富文本。创作页与编辑页均可在“AI 服务”中填写 OpenAI 兼容 URL、获取模型并保存配置。

模板 v2 提供杂志、复古纸页、手账、科技档案、商务报告、活动票券、国风与品牌画册等方向。模板库直接展示当前文章，支持风格检索、完整正文试用和取消恢复。AI 只输出语义内容，服务端整理 Markdown、标题层级、清单与长段落，模板统一决定视觉版式；重新生成保留所选模板。设计参考与适配规则见 [docs/template-design.md](docs/template-design.md)。

编辑页支持连续富文本、局部文字样式、段落排版、图片拖放与缩放，以及选区 AI 润色/缩短/扩写。AI 结果先预览再替换，保留撤销与双向定位。新增 `/api/articles/rewrite` 接口后需要重启后端服务。

创作、润色分别使用明确规则，正式/通俗/活泼语气影响表达，模板只控制视觉。正文目标范围为 ±15%，生成后实测并最多纠正一次；润色优先保留事实，无法达标时明确提示，不强行截断。编辑页持续显示字数和生成时警告，AI 重新生成沿用该文章的原始输入、设置、当前图片与所选模板。原文排版绕过 AI，仍可手动编辑。

## 开发

需要 Node.js 20.19+ 或 22.12+。

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

前端运行于 `http://localhost:5173`，API 运行于 `http://localhost:8787`。未配置 AI 服务时使用本地示例内容；可以在页面“AI 服务”中配置，也可以在 `.env` 中设置 `AI_BASE_URL`、`AI_API_KEY` 和 `AI_MODEL`。页面配置保存在服务端 `.local/ai-config.json`，密钥不会进入浏览器存储。复制会保留 HTML 排版，可粘贴到 135 编辑器或公众号后台；HTTPS 或 localhost 优先使用剪贴板 API，普通 HTTP 或接口不可用时尝试浏览器兼容复制。

局域网访问使用 Vite 输出的 Network 地址。开发代理保留页面 Host，并传递原始地址与协议；通过前端的 `/api` 访问时，不需要将每次变化的局域网 IP 加入 `ALLOWED_ORIGIN`。修改 `vite.config.js` 后需重启开发服务。前后端分属不同来源时，仍需将前端完整地址加入 `ALLOWED_ORIGIN` 并重启后端。

## 生产启动

```powershell
npm run build
npm start
```

生产启动前应先设置 `.env` 并执行构建；Express 同时提供 `dist/`、图片资源和 API。`ASSET_DIR` 用于图片持久化，默认保留七天，清理任务每日运行。`PUBLIC_BASE_URL` 配置可被公众号访问的 HTTPS 图片主机；留空时使用当前站点地址，复制结果会将非 HTTPS 图片替换为补图占位。

接口列表、错误码见 [docs/api.md](docs/api.md)。真实公众号后台粘贴回归和限制见 [docs/known-limitations.md](docs/known-limitations.md)。

# wechat-ai
