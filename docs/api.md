# API

所有接口返回 JSON；错误结构为 `{ "error": { "code": "...", "message": "..." } }`。响应包含 `X-Request-Id`。JSON 请求体上限 2 MB。

AI 生成、设计和编辑统一将上游 HTTP 失败归为 `AI_UPSTREAM_ERROR`，上游 `model_price_error` 归为 `AI_UPSTREAM_CONFIG_ERROR`，超时归为 `AI_TIMEOUT`。上游 HTTP 失败不进行输出纠正重试；自动接口探测仅在 Responses 接口不受支持时回退到 Chat Completions，并保留上游错误码。

AI 生成、设计和编辑成功响应的 `meta` 均增加 `usage:{inputTokens,outputTokens,cachedInputTokens}` 与 `cache:{hit,inputTokenHitRate}`，相同字段也写入现有请求日志。统计来自上游 Responses 的 `input_tokens_details.cached_tokens`、Chat Completions 的 `prompt_tokens_details.cached_tokens` 或 `prompt_cache_hit_tokens`，不按本地输入猜测命中。`inputTokenHitRate` 为缓存输入 token 数/全部输入 token 数，非请求命中率；输出纠正重试累计各轮用量。任一轮缺失或无效的字段累计值为 `null`，相关命中状态或比例也为 `null`；明确返回0则表示零命中，输入总数为0时比例为 `null`。接口探测失败不计为输出纠正调用。

编辑请求保持非流式输出，按固定系统规则、模板、全文、图片尺寸、历史对话、本轮要求、引用、重试错误的顺序组织输入，以保留更长的重复前缀。实际上下文缓存由上游服务提供，不缓存编辑方案或跳过校验；没有增加前端界面或服务商专用请求参数。缓存原理参见 [OpenAI 官方文档](https://developers.openai.com/api/docs/guides/prompt-caching)。

`design` 请求为 `{article:{title,summary,blocks},mode:"auto"|"prompt",prompt?:string}`。`prompt` 模式要求非空风格描述，最多1000字；`auto` 忽略提示词。发送模型前从全文构建语义内容，去掉模板及手动视觉样式，不截断正文。原文排版模式也可显式请求设计，文字不进入改写流程。未配置 AI 时明确报错，不以本地模板冒充生成结果。

响应为 `{design,meta:{model,retried}}`。设计通过 `ref` 按原顺序恰好引用全部标题、摘要和内容块；只返回受约束的布局树、样式和原文重点片段，由共享渲染器填入原文。校验内容完整性、强调片段、字号层级、正文行距、文字对比度（≥4.5）与累计横向留白（≤88px）；不允许任意HTML/CSS、脚本、外部字体或固定宽高。最多两次模型调用，共用120秒总超时。每来源默认每分钟10次（`RATE_DESIGN_PER_MIN`），与正文生成共享并发限制；取消连接会释放并发并中止上游请求。

前端在沙箱中检查320/375/414px下的实际横向溢出，通过后在主预览区试用，应用后写入文章 `layoutDesign` 并沿用草稿保存、撤销和复制。试用期间暂不复制，取消恢复原方案；正文发生变化时拒绝应用旧候选。结构增删或重排后按当前内容顺序复用样式，保证新增内容可见，提示重新设计以优化分组。浏览器检查不等于公众号真实粘贴回归。

`edit` 请求为 `{article,prompt,references?,messages?,attachments?}`，提交完整草稿与当前版式，修改要求1–4000字；`references`为关注点（最多100项），`messages`为最近最多16条对话（每条`{role:"user"|"assistant",text}`）。引用不限制修改范围，`raw`允许显式改写。文章已有图片默认只提交服务端缓存读取的宽高；图片引用可携带 `assetId`（须为正文已有图片），服务端读取缓存并缩放至 1280px 内的 JPEG 作为多模态输入，同时在 `visibleReferenceImages` 中列出，缓存已过期的图片跳过；本轮附件图片和文档内嵌图片会作为多模态输入交给模型。`attachments`最多5项，单张图片不超过10MB，单份文档不超过20MB，附件图片合计最多10张、20MB。支持 JPG/PNG/WebP、PDF、DOCX、TXT、MD；文档文字最多20万字。DOCX/PDF 提取内嵌图片，PDF 仅提取文本层和可读取图片，不做 OCR，扫描版或没有足够文本的 PDF 返回 `UNREADABLE_DOCUMENT`。识图模型不受支持时返回 `VISION_UNSUPPORTED`。引用仅在当前编辑会话中，对话、未应用方案、附件元数据与 Blob 按文章 ID 保存在浏览器 IndexedDB；图片资源同时由服务端缓存并在过期后可从本地 Blob 恢复。对话和候选均不在服务端持久化。

响应为`{message,operations,changes,meta:{model,retried}}`。操作支持`setTitle`、`setSummary`、`updateBlock`、`insertBlock`、`removeBlock`、`moveBlock`和`setLayout`，不接受任意HTML/CSS。`changes`由程序比较实际前后结果产生，不依赖模型自报；咨询可返回空操作。未配置AI返回`AI_NOT_CONFIGURED`，不使用示例结果；无效输出最多纠正一次，整体预算180秒，每来源默认每分钟20次（`RATE_EDIT_PER_MIN`），与生成/定制排版共享并发限制。客户端停止会中止上游模型请求。

客户端检查手机布局后在中间预览候选，确认前不修改或保存正文。应用时按修改对象与相关版式检查冲突，保留无关手动编辑；失效引用保留卡片，失效方案拒绝应用。一次应用沿用文章撤销/重做，并保存`settings.aiEdited`标记；对话、引用、候选不进入草稿、复制或导出。

全文允许编辑中的空段落、空标题和空列表项，空行原样保留。纯重排使用当前段落内容和样式，不将候选旧文本写回；内容并发修改及移动目标删除仍拒绝覆盖。普通文字操作与整篇版式均检查实际渲染后的对比度（至少4.5），包含继承底色与行内高亮；新引入的不可读样式按无效输出纠正一次，仍失败则返回`AI_EDIT_FAILED`。

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/health` | 服务状态与版本 |
| GET | `/api/config/status` | 脱敏返回平台 AI 的服务 URL、模型和密钥存在状态；未设置 `AI_MODEL` 时自动发现首个模型 |
| POST | `/api/config/models` | `{baseUrl,apiKey}`，临时验证个人服务凭证并发现排序、去重后的模型列表，不保存配置 |
| GET | `/api/admin/session` | 检查管理页会话 |
| POST | `/api/admin/login` | `{password}`，以 `BAOLONG_ADMIN_PASSWORD` 验证并建立 HttpOnly 会话 |
| POST | `/api/admin/logout` | 清除管理页会话 |
| GET | `/api/admin/config` | 管理会话下读取脱敏的平台 AI 配置状态 |
| POST | `/api/admin/models` | 管理会话下复用模型发现功能；已保存密钥可在服务地址不变时留空复用 |
| POST | `/api/admin/config` | 管理会话下验证并保存 `{baseUrl,apiKey,model}` 到项目根目录 `.env`，当前进程立即生效 |
| GET | `/api/templates` | v2.1.0，40 套模板元数据、视觉配置与内容适配信息（公众号真实回归完成前状态为 `draft`） |
| POST | `/api/materials/parse` | `multipart/form-data`，字段 `files`，最多 5 份 DOCX/PDF/TXT/MD |
| POST | `/api/assets` | `multipart/form-data`，字段 `file`，图片最多 10 MB |
| POST | `/api/assets/import` | `{url}`，读取公网 HTTPS 图片并返回与本地上传一致的素材 |
| DELETE | `/api/assets/:id` | 删除图片资源 |
| POST | `/api/articles/generate` | create/polish 模式生成结构化文章；raw 模式由共享解析器在前端完成 |
| POST | `/api/articles/design` | 根据全文或用户风格要求生成独立版式，保留全部原文与图片 |
| POST | `/api/articles/edit` | 基于全文、引用和对话返回待确认的内容与排版修改方案 |
| POST | `/api/articles/edit/attachments` | `multipart/form-data`，字段 `file`，解析 AI 修改附件并提取文档文字与内嵌图片 |

`generate` 请求字段：`mode`、`topic`、`text`、`materials[]`、`assetIds[]`、`tone`、`targetLength`、`aiProvider`（`platform` 或 `personal`），可选 `aiConfig:{baseUrl,apiKey,model}`（仅个人模式）和 `templateId`（T01–T40，重新生成时保留选中模板）。平台模式读取服务端环境变量；个人模式只使用本次请求携带的配置，不写入服务端。未指定模板时，根据规范化后的内容推荐初始模板。按 `AI_API_STYLE` 调用 OpenAI 兼容 Responses 或 Chat Completions 接口；`auto` 默认先尝试 Responses，不支持时回退 Chat Completions。未配置所选服务时返回 `AI_NOT_CONFIGURED`，不会生成示例内容。响应带 `meta`（提示词/Schema 版本、模型、耗时、重试状态）。`design` 和 `edit` 请求也接收相同的 `aiProvider` 与个人模式 `aiConfig` 字段。

`semantic-3` 提示词分别定义创作、润色和三种中文语气。事实与当前模式的保留要求优先于语气和长度，模板仅提供低优先级的块类型偏好，不提供主题或强制结构。服务端兼容 JSON 代码围栏、Markdown 正文、文字型段落和列表条目，保留加粗语义、去除 AI 视觉字段，整理标题层级与长段落；图片必须引用请求提供的 ID。原文排版不走此流程，继续在前端本地解析。

生成后按规范化内容实测正文非空白 Unicode 字符数（含标点、小标题、清单、引用及出处，不含主标题、摘要、图片标题和图注），目标范围为 ±15%。润色核对原文数字、日期与引语；Markdown 列表编号不当作事实数字。结构校验失败、字数偏离或受保护片段缺失时，最多再调用一次模型；已有合法草稿时提交 `revision` 要求定向修正。优先选择受保护片段缺失更少、长度更接近要求的结果；纠正失败保留已有合法草稿，始终不接纳结构无效的结果，不硬截断正文。格式仍无效时返回 `AI_INVALID_OUTPUT`。`meta.length` 返回 `{actual,target,min,max,within}`，`meta.protectedMissingCount` 返回需核对片段数；这些是部分规则检查，不能替代事实审核。

生成与重新生成不返回或保存生成警告，编辑画布不展示字数偏差、图片补齐等生成提示栏；未安排的图片仍自动补到正文末尾。旧草稿中的历史警告不再展示。总生成/纠正预算为 180 秒，单次请求仍受 `AI_TIMEOUT_MS` 限制，客户端最多等待 190 秒；客户端取消会终止模型请求并停止后续纠正。

客户端将成功生成时的输入单独保存在本地草稿 `generationInput`，不写入正文。AI 重新生成使用该输入、当前文章的模式/语气/目标长度、当前所选模板与正文实际引用的图片；新上传、替换或删除的图片不会退回首次提交的列表。原文排版重新解析原始输入并保留所选模板。生成期间正文或设置被修改时拒绝覆盖；成功替换后保存此前的文章快照，恢复时一并恢复模板和设置。缺少原始输入的旧草稿需返回创作页补充素材。

草稿内容块可选 `style` 保存 `fontSize`（12–40）、`align`（left/center/right/justify）、`lineHeight`（1.2–3）、`paragraphSpacing`（0–64px）、`indent`（0–4em）、`imageWidth`（20–100%）。文字 run 可选 `bold`、`underline`、`color`（原有语义颜色或六位十六进制颜色）及 `highlight`（六位十六进制颜色）。标题块可选 `runs` 保存局部格式，同时维护纯文字 `text`；旧草稿不需要迁移。手动样式在预览与复制中优先于模板默认值，AI 生成仍只提供语义内容。

个人 AI 的 API 密钥保存在用户当前浏览器本地存储中，调用模型时随单次请求发送至应用服务；服务端不保存个人密钥。平台 AI 由 `/baolongadmin` 管理页维护，访问密码通过部署环境变量 `BAOLONG_ADMIN_PASSWORD` 设置。管理会话为 8 小时有效的 HttpOnly、SameSite Strict Cookie；AI 密钥不会通过状态接口回传。配置写入 `.env` 并同步到当前进程，重启后由 `.env` 恢复。模型获取失败不会覆盖已保存的个人配置；所选 AI 未配置时相关接口返回 `AI_NOT_CONFIGURED`。

前后端使用同一公网域名时，反向代理应传递正确的 `X-Forwarded-Host` 和 `X-Forwarded-Proto`，服务端据此识别 HTTPS 同源请求。前后端域名不同时，将前端完整来源（例如 `https://app.example.com`，不带末尾路径）加入 `ALLOWED_ORIGIN`，多个来源用逗号分隔。若出现来源校验错误，模型列表请求尚未转发到模型服务。

Vite 开发代理显式设置 `changeOrigin: false` 与 `xfwd: true`，保留浏览器访问的 Host 并传递来源地址、端口与协议。本地和局域网经前端 `/api` 转发的请求按同源识别，不依赖固定 IP 白名单；避免字符串形式代理默认改写 Host 后触发 `ORIGIN_NOT_ALLOWED`。此修复保留现有来源校验与跨域白名单，不放行任意跨域请求。

图片 URL 仅在复制时允许 HTTPS；本地地址和未完成真实公众号验证的公网图均标记为需手动检查。

图片链接导入仅接受不带账号密码、默认 HTTPS 端口的公网地址，最多三次重定向、总下载时间 15 秒、原图和规范化结果均不超过 10MB；仅接收实际可解码的 JPG/PNG/WebP，单边不超过 8000px。下载前校验全部 DNS 结果并固定连接地址，跳转后重新校验；拒绝本机、私网、链路本地及保留地址。实现使用 Node.js 内置的 [HTTPS 请求](https://nodejs.org/api/https.html#httpsrequesturl-options-callback)和 [BlockList](https://nodejs.org/api/net.html#class-netblocklist)，不新增依赖。每来源默认每分钟 20 次（`RATE_IMPORT_PER_MIN` 可覆盖），全局同时最多处理两张远程图片，客户端断开时中止下载。

导入响应的 `asset` 在原有字段上增加 `cacheUrl`（本站缓存路径）和 `sourceUrl`（原始链接）；本地上传也返回 `cacheUrl`。`url` 优先使用配置的公网 HTTPS 缓存地址，否则链接图片使用原始 HTTPS 地址供复制。前端从缓存读取 Blob 保存草稿，重载按 `cacheUrl` 检查缓存，避免跨域 HEAD 误判；图片仍保持 `pasteStatus: needs-manual`，公众号端实际显示需检查。重新上传缓存时保留原图链接；删除仅移除本应用缓存，不请求删除图床资源。

导入错误包括 `INVALID_IMAGE_URL`、`IMAGE_URL_NOT_PUBLIC`、`IMAGE_TOO_LARGE`、`DIMENSION_EXCEEDED`、`INVALID_IMAGE`、`IMAGE_IMPORT_FAILED`、`IMAGE_IMPORT_TIMEOUT`、`IMAGE_PROXY_FAILED`、`IMAGE_PROXY_INVALID`。服务端默认直连图片主机；设置 `HTTPS_PROXY`（仅 http:// 代理）后通过代理 CONNECT 到已校验的公网 IP，`NO_PROXY` 中的域名仍直连。弹窗读取失败保留链接输入；正文粘贴先生成普通链接段落，验证成功后只转换仍保持原链接文字的段落。失败保留链接，正文已修改或图片数量达上限时只登记为素材，不覆盖内容。最多 10 张图片与 120 个内容块的限制与本地图片共用；AI 继续只引用登记 ID，原文排版不会调用模型。

`GET /api/config/status` 会返回 Base URL、模型 ID 和 `hasApiKey`，但绝不返回密钥内容。

模板推荐与微信 HTML 渲染是共享前端模块，避免 API 和预览复制出现两套实现。素材文本不会写入服务器日志；文档仅在内存解析，图片使用随机文件名并移除 EXIF。


## 整篇 HTML 编辑

编辑草稿的可选 `article.html` 为内容与版式保存源，最多600,000字符。`title/summary/blocks` 是从 HTML 提取的兼容摘要，供模板切换、字数和图片管理使用。旧结构仍被生成接口和原接口兼容；前端打开旧稿时转换为带稳定节点编号的 HTML。

`POST /api/articles/edit` 由 AI 根据要求、引用和对话自动选择局部或全文操作，不再接收手动范围。`messages` 可携带历史 `references`、`targets`（`html:节点编号` 或 `article`）以及 `status`（pending/applied/discarded/superseded/reverted/answered/failed/stopped）。失败、停止和仍在发送的用户消息不提交模型，历史引用文字最多200字，偏移仅供定位；当前真实引用保留完整文字。HTML 全文只发送一次，派生 blocks 仅保留编号、类型、前40字和图片编号。HTML 文章的操作为：

```json
{"type":"setHtml","intent":"layout","html":"完整文章 HTML 片段"}
```

```json
{"type":"replaceHtml","intent":"layout","referenceId":"本轮选区编号","html":"替换选区的 HTML"}
```

`intent` 默认为 `layout`，文字序列变化会被拒绝；用户明确要求内容改写时使用 `content`。本轮有引用也可根据用户明确的全文要求使用 `setHtml`。引用 `keys` 为单个 `html:节点编号`，对应 HTML 的 `data-node-id`；文字偏移按 UTF-16 计数，`br` 算一个换行，图片算一个 `U+FFFC`。整节点选区替换外层元素，部分文字选区替换内部片段并保留边界外结构；图片引用替换图片节点。无需本轮引用时，`replaceHtml` 可以指定当前 HTML 中的 `nodeId`，替换整个节点；可同时提供 `startOffset/endOffset` 只修改节点内的部分文字。`referenceId` 与 `nodeId` 必须二选一，目标不存在、偏移越界或原稿变化时拒绝覆盖。单元素替换保留目标节点编号，供后续对话继续定位。

HTML 只允许流式内容元素与内联样式，不接收脚本、事件、外部样式、定位、flex/grid、固定高度或隐藏内容。图片以 `data-asset-id` 引用当前文章已有资源，不接受 AI 指定 `src`。预览按资源映射补充地址，复制时去除内部 `data-*` 标记；本地图片的手动补图流程继续适用。模板更换和独立版式应用会重新生成 HTML，原稿可通过撤销恢复。

可选 `pendingChanges` 为当前未应用方案的改动摘要（`index/key/label/before/after`），编号与前端列表一致，供“第 N 处”指令定位。客户端可直接撤回单项，应用时按节点进行三方合并，保留不冲突的手动修改。`layoutRepair:{result,issue}` 携带上次方案与手机预览溢出详情，客户端最多发起一次修复，操作仍基于本轮原始 article。过滤不支持的样式时服务端先纠正一次；保留可用方案时在 message 说明忽略项。

附件可逐轮勾选，未选附件保留本地缓存但不发送。本轮附件图片（含图床链接经 `/api/assets/import` 导入的图片与文档内嵌图）以 `insertableImages:{assetId,name,width,height}` 列出并随图片内容发送，模型仅在用户要求配图时可用这些 `assetId` 插入；校验只放行文章已有图片与本轮附件图片，插入的图片在生成方案时登记到素材库，仍标记为需手动检查。`VISION_UNSUPPORTED` 后可只发送文档文字重试。并发按来源 IP 限制，另有全站总上限；本机反向代理的转发地址被信任，使 Vite 转发的不同客户端不共用同一来源额度。
