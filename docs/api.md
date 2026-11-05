# API

所有接口返回 JSON；错误结构为 `{ "error": { "code": "...", "message": "..." } }`。响应包含 `X-Request-Id`。JSON 请求体上限 2 MB。

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/health` | 服务状态与版本 |
| GET | `/api/config/status` | 脱敏返回服务 URL、模型列表、当前模型和密钥存在状态；未设置 `AI_MODEL` 的环境配置会自动发现首个模型 |
| POST | `/api/config/models` | `{baseUrl,apiKey?}`，验证服务凭证并发现排序、去重后的模型列表 |
| POST | `/api/config/ai` | `{baseUrl,apiKey?,model}`，重新验证模型后保存服务端配置 |
| DELETE | `/api/config/ai` | 删除页面保存的配置并恢复环境变量配置 |
| GET | `/api/templates` | v2.1.0，40 套模板元数据、视觉配置与内容适配信息（公众号真实回归完成前状态为 `draft`） |
| POST | `/api/materials/parse` | `multipart/form-data`，字段 `files`，最多 5 份 DOCX/PDF/TXT/MD |
| POST | `/api/assets` | `multipart/form-data`，字段 `file`，图片最多 10 MB |
| DELETE | `/api/assets/:id` | 删除图片资源 |
| POST | `/api/articles/generate` | create/polish 模式生成结构化文章；raw 模式由共享解析器在前端完成 |
| POST | `/api/articles/rewrite` | 仅修改所选文字，支持润色、缩短与扩写，响应为待用户预览的修改结果 |

`generate` 请求字段：`mode`、`topic`、`text`、`materials[]`、`assetIds[]`、`tone`、`targetLength`，可选 `templateId`（T01–T40，重新生成时保留选中模板）。未指定模板时，根据规范化后的内容推荐初始模板。AI 服务配置齐全时按 `AI_API_STYLE` 调用 OpenAI 兼容 Responses 或 Chat Completions 接口；`auto` 默认先尝试 Responses，不支持时回退 Chat Completions。未配置时响应使用带 `mockGenerated` 标记的本地示例内容。响应带 `warnings` 和 `meta`（提示词/Schema 版本、模型、耗时、重试状态）。

`semantic-3` 提示词分别定义创作、润色和三种中文语气。事实与当前模式的保留要求优先于语气和长度，模板仅提供低优先级的块类型偏好，不提供主题或强制结构。服务端兼容 JSON 代码围栏、Markdown 正文、文字型段落和列表条目，保留加粗语义、去除 AI 视觉字段，整理标题层级与长段落；图片必须引用请求提供的 ID。原文排版不走此流程，继续在前端本地解析。

生成后按规范化内容实测正文非空白 Unicode 字符数（含标点、小标题、清单、引用及出处，不含主标题、摘要、图片标题和图注），目标范围为 ±15%。润色核对原文数字、日期与引语；Markdown 列表编号不当作事实数字。结构校验失败、字数偏离或受保护片段缺失时，最多再调用一次模型；已有合法草稿时提交 `revision` 要求定向修正。优先选择受保护片段缺失更少、长度更接近要求的结果；纠正失败保留已有合法草稿并警告，始终不接纳结构无效的结果，不硬截断正文。格式仍无效时返回 `AI_INVALID_OUTPUT`。`meta.length` 返回 `{actual,target,min,max,within}`，`meta.protectedMissingCount` 返回需核对片段数；这些是部分规则检查，不能替代事实审核。

响应警告同时保存到可选的 `article.settings.generationWarnings`，供草稿恢复后继续展示；警告不参与正文、预览和复制。总生成/纠正预算为 180 秒，单次请求仍受 `AI_TIMEOUT_MS` 限制，客户端最多等待 190 秒；客户端取消会终止模型请求并停止后续纠正。无 AI 配置的本地示例明确提示未执行语气和目标长度，不返回真实生成的长度达标结论。

`rewrite` 请求为 `{text,action,mode?,tone?}`，其中 `text` 是 1–6000 字选区，`action` 为 `polish`、`shorten` 或 `expand`。编辑器传入当前文章模式和语气，旧客户端默认 `polish/plain`；`raw` 返回 `RAW_MODE_NO_AI`，无效模式或语气返回 `INVALID_SETTINGS`。只提交选区文字，不提交整篇文章或模板，选区长度按操作调整，不受整篇目标字数强制裁剪。数字、日期、引语缺失时重试一次，仍缺失则保留原文并返回失败。响应 `{text,meta:{model,action}}`，返回文字最多 12000 字；未配置 AI 时返回 `AI_NOT_CONFIGURED`，不使用本地假结果。客户端先展示可编辑结果，再替换原选区；原选区被修改、插入内容或删除时拒绝覆盖。取消会中断请求并保留原文。

客户端将成功生成时的输入单独保存在本地草稿 `generationInput`，不写入正文。AI 重新生成使用该输入、当前文章的模式/语气/目标长度、当前所选模板与正文实际引用的图片；新上传、替换或删除的图片不会退回首次提交的列表。原文排版重新解析原始输入并保留所选模板。生成期间正文或设置被修改时拒绝覆盖；成功替换后保存此前的文章快照，恢复时一并恢复模板、设置及生成警告。缺少原始输入的旧草稿需返回创作页补充素材。

草稿内容块可选 `style` 保存 `fontSize`（12–40）、`align`（left/center/right/justify）、`lineHeight`（1.2–3）、`paragraphSpacing`（0–64px）、`indent`（0–4em）、`imageWidth`（20–100%）。文字 run 可选 `bold`、`underline`、`color`（原有语义颜色或六位十六进制颜色）及 `highlight`（六位十六进制颜色）。标题块可选 `runs` 保存局部格式，同时维护纯文字 `text`；旧草稿不需要迁移。手动样式在预览与复制中优先于模板默认值，AI 生成仍只提供语义内容。

页面设置中的 API 密钥只在提交配置时发送到服务端，状态接口不会返回密钥；更换 URL 后需填写新密钥，同一 URL 可留空沿用已保存密钥。自定义配置保存在 `.local/ai-config.json`，优先于环境变量；删除自定义配置后恢复环境变量。配置写入只接受同源或 `ALLOWED_ORIGIN` 中的来源。模型获取或保存失败不会覆盖当前配置。完全未配置时生成接口使用本地示例；部分配置或自动发现模型失败时返回具体配置错误。

前后端使用同一公网域名时，反向代理应传递正确的 `X-Forwarded-Host` 和 `X-Forwarded-Proto`，服务端据此识别 HTTPS 同源请求。前后端域名不同时，将前端完整来源（例如 `https://app.example.com`，不带末尾路径）加入 `ALLOWED_ORIGIN`，多个来源用逗号分隔。若出现“此来源不能修改 AI 配置”，表示请求来源未通过此校验，模型列表请求尚未转发到模型服务。

Vite 开发代理显式设置 `changeOrigin: false` 与 `xfwd: true`，保留浏览器访问的 Host 并传递来源地址、端口与协议。本地和局域网经前端 `/api` 转发的请求按同源识别，不依赖固定 IP 白名单；避免字符串形式代理默认改写 Host 后触发 `ORIGIN_NOT_ALLOWED`。此修复保留现有来源校验与跨域白名单，不放行任意跨域请求。

图片 URL 仅在复制时允许 HTTPS；本地地址和未完成真实公众号验证的公网图均标记为需手动检查。

`GET /api/config/status` 会返回 Base URL、模型 ID 和 `hasApiKey`，但绝不返回密钥内容。

模板推荐与微信 HTML 渲染是共享前端模块，避免 API 和预览复制出现两套实现。素材文本不会写入服务器日志；文档仅在内存解析，图片使用随机文件名并移除 EXIF。
