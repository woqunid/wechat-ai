# Weave 公众号内容工作台

本地 Web 应用：输入主题或素材，生成文章草稿，编辑内容、切换 40 套模板，并复制微信兼容的富文本。创作页与编辑页均可在“AI 服务”中填写 OpenAI 兼容 URL、获取模型并保存配置。

## 开发

需要 Node.js 20.19+ 或 22.12+。

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

前端运行于 `http://localhost:5173`，API 运行于 `http://localhost:8787`。未配置 AI 服务时使用本地示例内容；可以在页面“AI 服务”中配置，也可以在 `.env` 中设置 `AI_BASE_URL`、`AI_API_KEY` 和 `AI_MODEL`。页面配置保存在服务端 `.local/ai-config.json`，密钥不会进入浏览器存储。浏览器富文本剪贴板要求 HTTPS 或 localhost。

## 生产启动

```powershell
npm run build
npm start
```

生产启动前应先设置 `.env` 并执行构建；Express 同时提供 `dist/`、图片资源和 API。`ASSET_DIR` 用于图片持久化，默认保留七天，清理任务每日运行。`PUBLIC_BASE_URL` 配置可被公众号访问的 HTTPS 图片主机；留空时使用当前站点地址，复制结果会将非 HTTPS 图片替换为补图占位。

接口列表、错误码见 [docs/api.md](docs/api.md)。真实公众号后台粘贴回归和限制见 [docs/known-limitations.md](docs/known-limitations.md)。

# wechat-ai
