# AI 微信公众号内容生成与排版系统 — 规格说明（spec.md）

版本：v1.0｜日期：2026-11-03｜基线：`wechat_ai_mvp_prd_v1.md`
本文是开发的唯一需求依据。与 PRD 冲突时以本文为准；本文对 PRD 的补充和修改见第 0 节。实现步骤与任务拆分见 `plan.md`。

---

## 0. 相对 PRD 的修订与补充

### 图片链接导入（2026-11-05）

- 图片弹窗提供本地图片和图片链接入口。链接先读取缩略预览，再确认插入或替换；正文单独粘贴 HTTPS 链接时先保留文字，成功后转换为图片，失败或原位置已修改时保留内容。
- 服务端仅下载公网 HTTPS 图片，逐次校验重定向与实际连接地址，限制下载时长、体积、格式及尺寸；不依据文件后缀判断图片。缓存原图规范化结果，登记现有 `assetId`，保留原始链接。
- 预览与浏览器草稿使用缓存图片及本地 Blob；复制使用配置的公网 HTTPS 缓存地址或原始 HTTPS 链接，沿用图片需检查提示。链接图片同样支持替换、缩放、图注、移动、撤销与双向定位，不计入正文目标长度；AI 仅引用已登记的 ID，原文排版不调用 AI。
- 统一限制最多 10 张正文图片、120 个内容块。导入取消或失败不插入损坏图片；删除素材只清理本应用缓存，不修改原图床文件。本轮不运行测试套件，仅做构建、语法及差异检查。

### 创作规则与业务联动（2026-11-05）

- 素材创作可重组已有信息并作中性分析；素材润色保留事实、重要细节、限定条件与叙事顺序；原文排版继续使用本地确定性解析，忽略主题、语气和长度，不提供 AI 选区修改，仍可手动编辑。
- 正式、通俗、活泼各有明确中文写作规则。事实与模式保留要求优先于语气，语气优先于长度，模板的块类型偏好优先级最低；模板不得诱导补造内容。
- 正文目标范围改为 ±15%。统计非空白 Unicode 字符（含标点、小标题、清单、引用和出处），排除主标题、摘要、图片标题及图注。规范化后实测字数；润色同步核对数字、日期及引语片段。最多两次模型调用，第二次修正已生成草稿；按片段保留情况、字数范围及距目标差值选择可用结果。纠正失败不丢弃已有合法草稿，保留明确警告，不硬截断正文。
- 首次生成与重新生成使用相同规则。成功生成时单独保存原始输入快照；重新生成绑定当前文章的模式、语气、目标长度和所选模板，保留撤销快照。旧草稿兼容现有输入；无法恢复原始素材时要求返回创作页补充。
- 编辑页持续展示模式、语气、正文实测字数及生成时警告；手动编辑和切换模板不重新调用 AI。选区修改继承文章语气，仅按选区操作调整长度，不重写整篇文章。生成警告和输入快照不进入预览或公众号复制内容。
- 完全未配置 AI 时明确显示本地示例，语气与长度不宣称已执行。生成与纠正共用总超时，并在客户端取消后停止后续模型调用。本轮仅做构建和语法检查，不运行测试套件。

### 连续编辑与局部修改（2026-11-05）

- 左侧正文使用连续富文本编辑，支持回车分段、删除合并、跨段选区与粘贴；文章仍保存为原有八种语义内容块，保留双向预览定位。
- 选中文字可单独加粗、改色、添加下划线和高亮。选中段落可调整字号、对齐、行距、段距与缩进，样式覆盖独立于模板默认值，支持恢复模板。
- 工具栏图片按钮直接打开现有图片弹窗，可选择已有图片或上传新图片，插在当前选区末段后；不再展开容易滚出视野的正文顶部素材条。插入与替换后自动定位编辑区及预览，统一限制最多 10 张图片、120 个内容块。继续支持文件拖入、粘贴截图、图片拖动重排、调整宽度与对齐、编辑图注，尺寸及位置同步预览和复制结果。
- AI 提供选区润色、缩短和扩写，提交内容仅限选区。结果先预览，再由用户替换选中文字；失败、取消或原选区已变更时不覆盖正文，替换支持已有撤销。
- 保持已有依赖，本轮按用户要求不运行测试套件，仅做必要语法和构建检查。

### 2026-11-04 模板与内容适配升级

- 保留 T01–T40 和 A–H 系列标识，增加杂志、复古纸页、手账、科技档案、票券、国风与品牌画册等原创排版。模板统一控制刊头、摘要、章节标题、编号、引用、清单、图片、结尾及所有视觉属性；正文不可依赖某个模板才能阅读。
- AI 只提供语义内容块，不提供模板 ID、字体、字号、颜色、CSS 或装饰字符。服务端规范化常见 JSON/Markdown 输出，拆分长段落、统一标题层级、校验图片引用，完成校验后才接受生成结果；润色和原文排版不得擅自删改事实。
- 模板全部支持八种内容块。无摘要、无章节、无图片时省略对应模块，保留原始顺序与文字；目录仅根据已有章节生成，装饰不伪造作者、期号、引用或数据。
- 模板库用当前文章生成缩略预览，展示视觉风格与内容适配说明；推荐结合主题、长度、章节、列表、引用和图片数量，仍返回三个不同系列。
- 编辑区与实时预览按内容块双向定位：点击或聚焦左侧标题、摘要、正文和图片，预览滚动并高亮对应内容；点击预览内容，左侧滚动并高亮对应编辑块。锚点只用于交互预览，不进入复制到公众号的 HTML；更新内容或切换模板后保留联动状态。
- 正文按原始内容顺序连续排版，不给整个章节套卡片、底色或多层边框；模板保留刊头、章节标题、导读、引用、重点、列表和图片样式。手机外框固定在预览区域内，只允许正文内部滚动；桌面双向定位仅滚动对应内容区。
- 输出继续限制为微信公众号兼容标签和内联样式，不依赖外部字体、第三方图片、复杂布局或脚本。预览保留 `sandbox="allow-same-origin"` 以支持现有文档写入和滚动恢复，禁止脚本执行。
- 本节优先于下文旧版模板的精确配色、固定字体及布局配置；本轮按用户要求不新增或运行测试，不执行浏览器和公众号后台回归，仅做必要编译检查。

| # | PRD 现状 | 本文处理 | 原因 |
|---|---|---|---|
| R1 | 内容块仅 4 种（heading/paragraph/imageCard/callout） | 扩为 8 种：heading、paragraph、image、imageCard、callout、list、quote、divider；行内支持加粗与文字色 | 模板（T02 引用卡、T34 引语框、T05 要点卡）和 AI 输出都需要 list/quote；分隔线是多套模板的特征 |
| R2 | "3 个不同风格子类"未定义 | 子类 = 模板系列 A–H（共 8 个），推荐取 3 个不同系列 | 使"不同风格"可机器校验 |
| R3 | "两个版式维度不同"未定义 | 定义 5 个版式维度（§6.2），要求同系列任意两套模板至少 2 个维度取值不同，由自动测试校验 | 防止"一个结构换 40 种颜色" |
| R4 | 原文排版如何识别结构未说明 | 用确定性规则解析，不调用 AI；用字符一致性检测兜底（§4.3） | PRD 要求不调用改写生成正文 |
| R5 | 图片能否带入公众号未定 | 引入"图片可粘贴性"三态（§8.4）：`ok` / `needs-manual` / `broken`；阶段 1 用真实公众号验证后定案 | 本地地址和 base64 基本不会被公众号后台接收 |
| R6 | 无技术栈 | 见 plan.md §1 | — |
| R11 | 未定 AI 接口风格 | 仅 OpenAI 兼容；服务端同时支持 Chat Completions 与 Responses，启动探测自动选择，用户无选择项 | 需求方确认 |
| R12 | 验收含大量自动化测试 | MVP 不编写自动化测试；A01–A10 及批量测试作为需求方独立测试的检查口径，不作为交付前置 | 需求方确认 |
| R13 | AI 只能通过环境变量配置 | 支持在页面填写 OpenAI 兼容服务 URL 与 API Key，自动获取模型列表，选择并保存模型；不提供服务商或接口风格选择 | 自动获取模型需求 |
| R7 | 无账号体系，但提到"用户删除机制" | MVP 无登录；删除机制为"清空本地草稿 + 删除已上传图片"；服务端按 IP 限流 | 控制范围 |
| R8 | "桌面端 Web 应用"与 320/414px 适配并存 | 解释为：应用本体面向桌面浏览器（≥1280px），手机预览区提供 320/375/414 三档宽度 | 消除歧义 |
| R9 | 推荐"AI 负责推荐说明" | 推荐说明有规则模板兜底，AI 失败不影响推荐 | 推荐必须可用且确定性 |
| R10 | 预览与复制"同一渲染器" | 明确：共享包 `renderer` 输出同一份 HTML 字符串；预览用沙箱 iframe `srcdoc` 展示，复制用同一字符串 | 可测试 |

---

## 1. 产品概述

### 1.1 目标
用户提供主题和素材，AI 生成或保留原文；系统从 40 套原创模板中推荐 3 套；用户编辑、切换模板、在仿公众号手机视图中预览；一键复制可粘贴到公众号后台的富文本。

### 1.2 范围（MVP 六项）
M01 输入素材与要求｜M02 AI 生成/保留原文并可编辑｜M03 40 套模板｜M04 推荐 3 套｜M05 手机预览与切换｜M06 复制微信兼容富文本。

### 1.3 非目标（不得实现）
SVG 动画、渐变与复杂特效、JavaScript 交互、视频、浮动多列、整页抓取、自动群发/发布、草稿箱 API、AI 配图、协作/权限/付费、登录注册、拖拽画布。不得复制 135 编辑器等第三方模板资产。

### 1.4 目标用户与环境
- 用户：公众号运营者、个人写作者、企业宣传人员。
- 运行环境：桌面 Chrome / Edge 最新两个大版本；优先使用 HTTPS（本地开发 `localhost` 视为安全上下文），普通 HTTP 支持浏览器兼容复制。
- 语言：界面与生成内容均为简体中文。

---

## 2. 用户流程

1. 进入 P01 创作页：输入主题/粘贴正文/上传文档与图片，选择模式、语气、长度。
2. 点击"生成文章"或"开始排版"，进入加载态（阶段：提取素材 → 生成/解析 → 推荐模板）。
3. 进入 P02 编辑排版页：左侧编辑内容，中间手机预览，右侧推荐 3 套与"全部 40 套"入口。
4. 编辑自动保存（防抖 800ms）到浏览器 IndexedDB。
5. 切换模板：只改变渲染，不改内容。
6. 点击"复制到公众号"：写入剪贴板，弹出 P04 反馈。

---

## 3. 页面规格

### 3.1 P01 创作页

| 区域 | 元素 | 规则 |
|---|---|---|
| 素材区 | 文本框（粘贴正文） | ≤30,000 字；实时字数；超限红色提示并禁用提交 |
| | 文档上传 | 拖拽/点击；`.docx/.pdf/.txt/.md`；≤5 个、单个 ≤20MB；逐个显示状态（解析中/成功/失败+原因）和提取文本前 200 字预览；可单独删除 |
| | 图片上传 | `.jpg/.jpeg/.png/.webp`；≤10 张、单张 ≤10MB；缩略图列表，可删除、可排序 |
| 要求区 | 主题输入 | ≥5 字符（去首尾空白后计数） |
| | 模式 | 单选：素材创作 / 素材润色 / 原文排版，附一句说明 |
| | 语气 | 正式 / 通俗 / 活泼，默认通俗；原文排版模式隐藏 |
| | 目标长度 | 约 600 / 1000 / 1500 / 2000 字，默认 1000；原文排版模式隐藏 |
| 提示 | AI 隐私声明 | 固定文案："素材将提交给 AI 服务处理"，首次提交需勾选确认，之后记住 |
| 操作 | 主按钮 | 文案随模式变化（"生成文章"/"开始排版"）；校验未通过时禁用并给出原因 |

校验矩阵：

| 模式 | 必填 |
|---|---|
| 素材创作 | 主题 ≥5 字符，或有正文/文档素材（至少一项） |
| 素材润色 | 必须有正文或文档素材（主题可选） |
| 原文排版 | 必须有正文或单个文档素材；多个文档合并时按上传顺序用空行拼接；忽略主题、语气、长度 |

提示语：无任何输入 →"请输入主题或上传/粘贴素材"。

### 3.2 P02 编辑排版页（三栏，≥1280px）

- 左栏（内容编辑，约 380px）：标题、摘要、块列表（见 §4）、"重新生成"、"返回修改素材"。
- 中栏（手机预览）：宽度切换 320/375/414/宽屏检查，默认 375；顶部仿公众号导航；内部独立滚动。
- 右栏（模板，约 320px）：推荐 3 套（缩略图+名称+系列+推荐理由+当前选中态）、"全部 40 套"按钮。
- 顶栏：草稿状态（已保存时间）、"复制到公众号"主按钮、"清空草稿"。

### 3.3 P03 模板选择弹层
- 按 8 个系列分类标签+"全部"；搜索框（匹配名称、系列、风格标签）；缩略图网格（懒加载）。
- 点击缩略图：主预览即时应用（试用态）；点"确定"保存，"取消"恢复原模板。
- 当前模板与推荐模板有标记。
- 无搜索结果显示"没有匹配的模板"。

### 3.4 P04 复制反馈弹层
- 成功：显示"HTML 排版已复制"，提示在 135 编辑器或公众号后台按 Ctrl+V 粘贴并检查版式与图片；图片检查清单（逐张列出缩略图+可粘贴性状态+"下载原图"）；按钮"重新复制""关闭"。
- 失败：仅在剪贴板 API 与浏览器兼容复制均未成功时提示；权限被拒时提示允许剪贴板访问，其他错误提示使用 Chrome/Edge 桌面版；提供"重新复制 HTML"，不提供纯文本降级入口。

### 3.4.1 通用状态要求
每个页面必须实现：空态、加载态、错误态（含重试）、成功态。禁止出现无反馈的静默失败。

---

## 4. 功能需求

### 4.1 FR-01 素材输入与解析

| 项 | 规则 |
|---|---|
| 文本总量 | 正文 + 所有文档提取文本合计 ≤30,000 字 |
| 解析 | 服务端 `POST /api/materials/parse`；docx 取正文段落与标题（忽略页眉页脚、批注）；pdf 仅提取文本层；txt/md 按 UTF-8（失败时尝试 GBK）解码 |
| 提取质量检查 | 提取文本去空白后 <20 字，或乱码字符（U+FFFD、控制符）占比 >5% → 判定失败，提示"无法读取文本，请粘贴文字" |
| 不支持 | 扫描版 PDF、加密文件、损坏文件、扩展名与内容类型（magic bytes）不符 |
| 失败隔离 | 单文件失败不影响其他输入与已成功文件 |
| 图片 | 客户端先校验类型和大小；上传 `POST /api/assets`；服务端校验 magic bytes、解码尺寸（宽/高 ≤8000px）、移除 EXIF（含 GPS）；返回 assetId、宽高、url |
| 展示 | 展示提取文本片段（前 200 字）以便用户发现乱码 |

### 4.2 FR-02 三种创作模式

| 模式 | 行为 | 保护规则 |
|---|---|---|
| create 素材创作 | 依据主题+素材生成大纲与文章 | 不得新增具体数字、引述、人物、机构、事件；无资料处使用中性表达或标注"（待核实）" |
| polish 素材润色 | 保留事实，改善标题、结构、措辞 | 数值、日期、专有名词、原始引述必须一致；用后置校验（§4.2.1） |
| raw 原文排版 | 不调用 AI 改写；规则解析为块 | 字符一致性检测（§4.3） |

设置：tone ∈ {formal, plain, lively}；targetLength ∈ {600,1000,1500,2000}。三种语气分别定义具体中文写法；正文生成后按目标 ±15% 实测，超出时在总计两次模型调用内尝试纠正，仍未达标则保留可用正文并警告，不强制截断。输入全文 > 目标长度×1.2 时，创作模式提示可能压缩信息；润色模式提示优先保留事实和重要细节、可能超过目标，用户可继续。

#### 4.2.1 润色模式后置校验
从原文提取"受保护片段"：阿拉伯数字串（含小数、百分号、金额）、日期、引号内原文及 Markdown 引用；排除 Markdown 列表编号。检查新标题与正文中是否保留，不能只放入摘要或图注来通过检查；数值按完整片段匹配，避免把 10 误判为已保留在 100 中。缺失时尝试纠正，仍缺失的列入持久警告，不阻止用户继续编辑。这是片段检查，事实、名称和语义准确性仍需审核。

### 4.3 FR-02b 原文排版解析与一致性检测

解析规则（按优先级，确定性、无 AI）：
1. Markdown：`#`→heading level1（仅第一个 `#` 且位于文首，作为文章标题）、`##`/`###`→heading level 2、`- `/`1. `→list、`>`→quote、`---`→divider、`![](...)` 忽略并提示（图片需通过上传）、`**x**`→加粗 run。
2. 纯文本：首行（≤30 字、无句末标点）作为主标题；单独成行、≤25 字、无句末标点（。！？；，.!?;,）的行作为二级标题；形如 `一、`、`1.`、`（一）`、`第X部分` 开头的短行作为二级标题；连续以 `-`、`•`、`1.` 开头的行合并为 list；空行分段。
3. docx：Word 样式 Heading1/2/3 映射为 heading；列表样式映射为 list；加粗 run 保留。
4. 其他一律为 paragraph。
5. 摘要为空（可由用户手填）。

**一致性检测**：令 `plain(x)` = 去除所有空白字符并移除 Markdown/编号/项目符号等"结构标记"后的文本。要求 `plain(各块文本按序拼接) === plain(源文本)`。不一致时：阻止进入编辑页，显示差异定位（首个不一致位置前后各 20 字），并提供"仍然继续"的二次确认（记录日志）。此检测在前端共享包中实现，并有单元测试覆盖。

### 4.4 FR-03 AI 生成输出

- 服务端调用模型，要求返回符合 `ArticleDraft` Schema（§5.1）的 JSON；使用 Zod 校验；不允许任意 HTML/CSS。
- 校验失败或超时（单次 90 秒）→ 自动重试 1 次（附上校验错误信息）→ 仍失败返回错误码，由用户手动重试。
- 失败不覆盖现有文章；输入保留。
- 内容约束：块总数 ≤120；单个 paragraph ≤1200 字；heading ≤40 字；标题 ≤64 字（公众号标题限制）；摘要 ≤120 字。
- 图片位置：用户上传 N 张图时，模型必须输出 N 个引用 `imageAssetId` 的块（每张最多一次），无法确定位置时放在相应章节后；服务端后处理补齐遗漏图片到末尾并警告。
- 提示词与 Schema 版本化（`promptVersion`、`schemaVersion`），随响应返回便于排查。
- "重新生成"：仅在 P02 左栏提供，必须二次确认（"将替换当前正文，已编辑内容会丢失"）；确认前自动做一次本地快照，生成成功后允许"撤销到重新生成前"（保留 1 份快照）。切换模板不触发生成。

### 4.5 FR-04 正文编辑

| 操作 | 规则 |
|---|---|
| 标题/摘要 | 纯文本输入；标题 ≤64 字，超出计数变红但允许保存，复制时提示 |
| 块编辑 | 每块独立编辑区：段落/提示框/引用支持行内加粗与文字重点色（预设 5 色：模板主色、强调色、红、橙、绿，不开放任意取色）；Enter 在块末尾新建 paragraph；粘贴时去除外部格式，仅保留纯文本 |
| 块操作 | 新增（在任意块之后，选择类型）、删除（带撤销 5 秒）、上移/下移、类型切换（paragraph ↔ heading1 ↔ heading2 ↔ callout；切换保留文字；含加粗 runs 的块切为 heading 时降级为纯文本并提示） |
| 图片 | 在任意块间插入（从已上传图库选择或新上传）；替换；删除；编辑 caption；image 与 imageCard 可互相切换；图片保持原始宽高比 |
| 撤销/重做 | 本页内 Ctrl+Z/Ctrl+Shift+Z，栈深 100 |
| 保存 | 见 §4.5.1 |
| 样式边界 | 用户不能设置字号、行距等；这些由模板决定 |

#### 4.5.1 本地草稿
- 存储：IndexedDB。`drafts`（当前文章 JSON，最近 1 篇；保留 1 份"重新生成前快照"）、`blobs`（图片原文件，键=assetId）、`inputs`（P01 表单内容，便于"返回修改素材"）。
- 防抖 800ms 保存；"已保存 HH:MM:SS"状态；保存失败（配额满）提示并建议清理。
- 页面启动检测到草稿 → 询问"继续编辑上次草稿 / 新建文章"。
- 首次使用提示："草稿保存在当前浏览器，清理浏览器数据或更换设备可能丢失"。
- 网络中断：编辑与预览不依赖网络；仅生成/上传/解析需联网，失败提示"网络中断，内容已保留"。

### 4.6 FR-05 模板系统
见第 6 节（模板定义）和第 7 节（推荐）。

### 4.7 FR-06 手机预览

- 容器：圆角手机外框，内部宽度 = 选中宽度（320/375/414），高度自适应窗口，内容区独立滚动。
- 仿公众号顶部：状态栏（时间/信号/电量静态图形）、导航栏（返回箭头、"…"）。文章头：标题（由模板渲染）、公众号名称（"公众号名称"占位，可在 P02 顶栏设置，默认"我的公众号"）、日期（当天）。结尾：占位"阅读原文"区域不实现。
- 渲染：iframe `sandbox=""`（无脚本）+ `srcdoc`；srcdoc 内容 = `renderer.renderArticle(article, template, {mode:'preview'})`。复制使用 `{mode:'wechat'}`，二者除"预览外壳（导航/状态栏）"外主体 HTML 必须一致（有单元测试断言）。
- 更新：编辑后 ≤150ms（防抖）更新；更新保持滚动位置。
- 图片加载失败：显示占位块+"图片无法加载，点击更换"，不得消失。
- 宽屏检查：切换到 ≥720px 宽度，验证模板不崩坏，仅为检查用途。

### 4.7.1 FR-07 复制微信兼容富文本
见第 8 节。

---

## 5. 数据模型

### 5.1 TypeScript 定义（共享包 `core`，同时导出 Zod Schema）

```ts
type Mode = 'create' | 'polish' | 'raw';
type Tone = 'formal' | 'plain' | 'lively';
type ColorKey = 'primary' | 'accent' | 'red' | 'orange' | 'green';

interface Run { text: string; bold?: boolean; color?: ColorKey }   // 行内片段，text 非空

type Block =
  | { id: string; type: 'heading';   level: 1 | 2; text: string }
  | { id: string; type: 'paragraph'; runs: Run[] }
  | { id: string; type: 'callout';   runs: Run[] }
  | { id: string; type: 'quote';     runs: Run[]; cite?: string }
  | { id: string; type: 'list';      ordered: boolean; items: Run[][] }
  | { id: string; type: 'image';     assetId: string; caption?: string }
  | { id: string; type: 'imageCard'; assetId: string; title?: string; caption?: string }
  | { id: string; type: 'divider' };

interface Article {
  schemaVersion: 1;
  id: string;                    // nanoid
  mode: Mode;
  title: string;                 // ≤64 建议
  summary: string;               // ≤120，仅供编辑参考，不进入复制 HTML
  blocks: Block[];               // 顺序即阅读顺序；id 在文章内唯一
  templateId: string;            // 'T01'..'T40'
  settings: { tone?: Tone; targetLength?: 600 | 1000 | 1500 | 2000; accountName?: string };
  rawSourceHash?: string;        // raw 模式：源文本 plain() 的 SHA-256，用于一致性复核
  createdAt: string; updatedAt: string;   // ISO 8601
}

interface Asset {
  id: string;                    // 'img_xxx'
  filename: string; mime: 'image/jpeg' | 'image/png' | 'image/webp';
  width: number; height: number; bytes: number;
  url: string;                   // 服务端可访问地址
  expiresAt?: string;            // 服务端保留到期
  pasteStatus: 'ok' | 'needs-manual' | 'broken';   // 见 §8.4
}
```

**AI 输出 Schema**：`ArticleDraft = Pick<Article,'title'|'summary'|'blocks'>`，其中图片块只允许引用请求中提供的 assetId，block.id 由服务端重新生成（不信任模型）。

校验规则（服务端与前端一致）：块类型在白名单内；文本不含控制字符；`runs` 至少 1 项且 text 非空；list.items 1–30 项；assetId 必须存在于素材清单；`templateId` 必须在模板库中。

### 5.2 模板数据模型

```ts
interface TemplateMeta {
  id: string;            // T01..T40
  name: string;
  series: 'A'|'B'|'C'|'D'|'E'|'F'|'G'|'H';
  seriesName: string;
  industries: string[];  // 适用行业/内容类型
  styleTags: string[];   // 风格标签，如 ['极简','留白']
  layout: LayoutDims;    // §6.2
  tokens: DesignTokens;  // §6.3
  fit: { lengths: Array<'short'|'medium'|'long'>; imageAffinity: 0|1|2|3; headingAffinity: 0|1|2|3 };
  status: 'draft' | 'available';   // 仅通过 §10.2 测试后可置 available
  version: string;
}
```

### 5.3 前端状态
`useDraftStore`（文章、历史栈、保存状态）、`useUiStore`（预览宽度、弹层）、`useInputStore`（P01 表单）。文章状态为单一事实来源，预览、复制、推荐均为其派生。

---

## 6. 模板系统

### 6.1 总体规则
- 固定 40 套，ID `T01`–`T40`，`GET /api/templates`（或静态 JSON）返回数量必须恰好为 40，且 `status==='available'`（上线门槛）。
- 每套覆盖：主标题、H1、H2、正文、引用、列表、分隔线、callout、image、imageCard，无论文章是否使用。
- 模板由"版式维度+设计 token"经**同一套渲染函数**生成样式，不为每套手写 HTML；版式维度各取值对应一段经过微信兼容测试的 HTML 结构生成器。
- 每套须有缩略图：由渲染器对"标准样张"自动截图生成（非手绘），构建时产出 `thumb-Txx.png`（尺寸 300×540）。

### 6.2 版式维度（LayoutDims）

| 维度 | 取值 |
|---|---|
| `titleLayout` | left-large 左对齐大标题｜center 居中｜underline 下划线｜bar 实色标题条｜band 色带标题（深/品牌色底白字）｜frame 边框标题框｜masthead 刊头框｜tag 顶部标签+标题｜split 小眉题+标题｜stacked 叠层（编号/眉题在上）｜pill 圆角标题底 |
| `sectionMark` | none｜hairline 细线｜num-prefix 数字前置｜num-square 序号方块｜side-line 侧边竖线｜tag 标签｜short-line 短横线｜big-num 大号编号｜question 问题标记｜step 步骤编号｜index-row 横向索引｜dot 圆点 |
| `calloutStyle` | thin-frame 细框｜soft-fill 浅色底块｜side-bar 左侧粗线+浅底｜double-frame 双线框｜solid-fill 实色底白字｜rounded-fill 圆角浅底｜gold-frame 金色细框｜dashed-frame 虚线框 |
| `cardStyle` | plain 无框图文｜bordered 边框卡｜rounded 圆角卡｜story 故事卡（图上、文字加底色）｜info 信息卡（标题+简介分区）｜image-first 图片优先｜compact 紧凑图注｜flow 流程/步骤卡 |
| `rhythm` | tight 紧凑｜normal 常规｜airy 疏朗（控制行距、段距、章节间距） |

**差异性约束（自动测试）**：同系列任意两套模板，上述 5 个维度中取值不同的个数 ≥2。本表已使同系列所有模板的 `titleLayout` 与 `sectionMark` 两两不同，满足约束；测试需保留该断言防止后续修改破坏。

### 6.3 设计 token

```ts
interface DesignTokens {
  primary: string;      // 主色（标题/边框/重点）
  tint: string;         // 浅底色（提示块/卡片底）
  accent: string;       // 强调色（标签/数字/细节）
  text: string;         // 正文色，默认 #333333（深色系可调整，但对白/浅底对比度 ≥7:1）
  textMuted: string;    // 辅助文字色（说明/图注），对其底色对比度 ≥4.5:1
  onPrimary: string;    // 主色底上的文字色，对 primary 对比度 ≥4.5:1
  bodySize: 15 | 16;    // 默认 16
  lineHeight: number;   // 由 rhythm 决定：tight 1.65 / normal 1.8 / airy 2.0
  paraGap: number;      // 段距 px：tight 12 / normal 18 / airy 24
  sectionGap: number;   // 章节间距 px：tight 28 / normal 36 / airy 48
  radius: number;       // 圆角 px：0 / 4 / 8 / 12
  letterSpacing: number;// 0 | 0.5 | 1（px，对标题/正文）
}
```

通用约束：正文字号 15–16px；一级标题 20–24px；二级标题 17–19px；注释 13px；字体栈固定 `-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`，不引用外部字体。左右内边距默认 16px。

### 6.4 40 套模板完整配置

表头：标题=titleLayout，标记=sectionMark，提示=calloutStyle，卡片=cardStyle，节奏=rhythm。颜色均为十六进制。圆角 `radius` 取值：T04/T06/T07/T09/T13/T14/T18/T22/T23/T26/T28/T31/T32/T33/T35/T36/T37/T39 = 0 或 2；T01/T02/T03/T05/T08/T10/T12/T15/T17/T19/T29/T30/T34/T40 = 4；T11/T16/T21/T24/T25/T27/T38 = 8–12；T20 = 12（实现时可在 token 中精确定义，须保持与说明一致）。

**A. 极简阅读（A）**

| ID | 名称 | 标题 | 标记 | 提示 | 卡片 | 节奏 | 主色 | 浅底 | 强调 | 视觉要点 |
|---|---|---|---|---|---|---|---|---|---|---|
| T01 | 留白阅读 | left-large | hairline | soft-fill | plain | airy | #333333 | #F5F5F5 | #888888 | 深灰/白，无装饰正文、细线章节分隔 |
| T02 | 居中杂志 | center | none | thin-frame | bordered | airy | #8B7355 | #F7F2E7 | #4A4038 | 居中主标题，窄幅导语，细框引用卡 |
| T03 | 书页长文 | underline | num-prefix | soft-fill | compact | normal | #2F5D50 | #F4ECD2 | #8A7A4A | 章节编号置前，纸张色背景块，紧凑图注 |
| T04 | 黑白专栏 | bar | dot | thin-frame | bordered | tight | #000000 | #F2F2F2 | #666666 | 黑色标题条，极细黑边框，黑白图文卡 |
| T05 | 清单解析 | split | num-square | soft-fill | info | tight | #5B7C99 | #EAF0F5 | #34495E | 数字型小标题，分段色块，紧凑要点卡 |

**B. 科技资讯**

| ID | 名称 | 标题 | 标记 | 提示 | 卡片 | 节奏 | 主色 | 浅底 | 强调 | 视觉要点 |
|---|---|---|---|---|---|---|---|---|---|---|
| T06 | 蓝线科技 | left-large | side-line | soft-fill | bordered | normal | #1E6FD9 | #EAF3FF | #0B4AA2 | 蓝色侧线标题，浅蓝提示块，直角卡 |
| T07 | 深蓝观察 | band | tag | thin-frame | bordered | normal | #14305A | #E6EEF7 | #19B5D6 | 深色章节头，亮色标签，窄边图文框 |
| T08 | 未来简报 | tag | hairline | dashed-frame | info | tight | #0E9F8E | #E8F6F4 | #2B2F33 | 顶部编号标签，横向分隔线，模块化信息卡 |
| T09 | 数据雷达 | stacked | big-num | solid-fill | bordered | normal | #3B3FB6 | #ECEDF8 | #7C8294 | 数据式编号，重点数字底色，矩形边框 |
| T10 | 产品手记 | split | none | side-bar | image-first | airy | #1BA3C6 | #F1F8FA | #0E6E87 | 小标签导语，图片优先卡，轻边线正文 |

**C. 商务报告**

| ID | 名称 | 标题 | 标记 | 提示 | 卡片 | 节奏 | 主色 | 浅底 | 强调 | 视觉要点 |
|---|---|---|---|---|---|---|---|---|---|---|
| T11 | 商务深绿 | band | side-line | rounded-fill | rounded | normal | #1F5A3C | #F5F1E4 | #3E8E63 | 深绿标题底条，竖线重点，圆角信息卡 |
| T12 | 蓝灰月报 | underline | index-row | soft-fill | info | normal | #4C6A85 | #EDF1F5 | #2E4256 | 横向章节索引，灰蓝背景卡，清晰分隔 |
| T13 | 管理洞察 | frame | big-num | double-frame | bordered | airy | #3A3A3A | #F4EFE6 | #A67C3B | 大号章节编号，双层线框，结论强调块 |
| T14 | 品牌公报 | masthead | short-line | thin-frame | info | normal | #1B2E57 | #F0F2F5 | #5C6B8A | 顶部刊头框，短标题线，规范信息卡 |
| T15 | 战略笔记 | left-large | question | soft-fill | plain | airy | #2B2B2B | #FBF1E8 | #D2691E | 提问式章节标题，浅底重点块，留白长文 |

**D. 教育科普**

| ID | 名称 | 标题 | 标记 | 提示 | 卡片 | 节奏 | 主色 | 浅底 | 强调 | 视觉要点 |
|---|---|---|---|---|---|---|---|---|---|---|
| T16 | 校园蓝本 | left-large | num-square | rounded-fill | rounded | normal | #1E88C9 | #E8F4FB | #0F5F90 | 分节序号方块，浅蓝说明卡，柔和边框 |
| T17 | 知识拆解 | tag | tag | solid-fill | image-first | normal | #2F7D5B | #F6F1E1 | #1D5740 | 概念标签，定义色块，知识图片卡 |
| T18 | 课堂讲义 | underline | side-line | side-bar | plain | tight | #1D3A70 | #FBF7EC | #3B5FA8 | 直线标题，左框知识点，规则段距 |
| T19 | 问答科普 | split | question | soft-fill | bordered | normal | #5BA05A | #F0F7EC | #333333 | 问题型小标题，回答背景块，卡片分段 |
| T20 | 成长记录 | pill | dot | rounded-fill | story | airy | #F0A030 | #FFF6E6 | #B86E00 | 温和圆角标题，照片故事卡，柔色注释 |

**E. 生活方式**

| ID | 名称 | 标题 | 标记 | 提示 | 卡片 | 节奏 | 主色 | 浅底 | 强调 | 视觉要点 |
|---|---|---|---|---|---|---|---|---|---|---|
| T21 | 温柔日常 | split | none | rounded-fill | rounded | airy | #B08968 | #F8F1E7 | #7A5A3F | 细字标题，圆角米色卡，舒缓留白 |
| T22 | 都市品味 | left-large | hairline | thin-frame | bordered | normal | #1A1A1A | #F6F0E0 | #B8955A | 大字号杂志标题，窄线分割，图片说明框 |
| T23 | 自然手账 | stacked | step | soft-fill | bordered | normal | #8FAE8B | #F1EFE3 | #5E7B5A | 手账式序号，浅绿底卡，朴素边框 |
| T24 | 轻氧生活 | band | short-line | rounded-fill | rounded | normal | #3CB89A | #EAF8F4 | #1E7F69 | 蓝绿分节条，白底圆角图卡，轻装饰 |
| T25 | 暖色故事 | center | side-line | side-bar | story | airy | #E8833A | #FFF8EC | #A8541A | 居中引言，暖色侧线，故事图片卡 |

**F. 活动通知**

| ID | 名称 | 标题 | 标记 | 提示 | 卡片 | 节奏 | 主色 | 浅底 | 强调 | 视觉要点 |
|---|---|---|---|---|---|---|---|---|---|---|
| T26 | 活动公告 | frame | none | solid-fill | info | normal | #D32F2F | #FFF1F1 | #8E1B1B | 醒目标题框，时间地点信息块，内容分节 |
| T27 | 清爽邀请 | center | dot | soft-fill | flow | airy | #4DA6E8 | #F0F3F6 | #2B77B3 | 居中邀请标题，柔色背景，流程卡 |
| T28 | 课程招生 | band | num-prefix | solid-fill | info | tight | #1F5FD0 | #EEF3FC | #0F3C8A | 信息条标题，报名信息底框，列表段落 |
| T29 | 节日特刊 | masthead | short-line | double-frame | rounded | normal | #C8102E | #FFF0E0 | #C9A24B | 装饰边框标题，节庆红底块，暖色图卡 |
| T30 | 社群招募 | tag | tag | rounded-fill | bordered | normal | #5B5BD6 | #F1EEFB | #8E6FD8 | 标签式标题，优势卡片，结尾行动框 |

**G. 新闻媒体**

| ID | 名称 | 标题 | 标记 | 提示 | 卡片 | 节奏 | 主色 | 浅底 | 强调 | 视觉要点 |
|---|---|---|---|---|---|---|---|---|---|---|
| T31 | 新闻快讯 | left-large | hairline | thin-frame | compact | tight | #1A1A1A | #F3F3F3 | #B3202A | 头条字阶，窄线分隔，规整图注 |
| T32 | 专题报道 | masthead | side-line | double-frame | plain | normal | #1B3A6B | #F0F2F5 | #5F7191 | 专题眉题，双边框导语，分节长文 |
| T33 | 热点速读 | tag | big-num | solid-fill | info | tight | #E8542A | #F5F5F5 | #333333 | 栏目标识，数字标题，重点摘要色块 |
| T34 | 人物访谈 | frame | tag | thin-frame | story | airy | #7B1E2B | #FAF3E8 | #A8556A | 引语大框，姓名标签，照片介绍卡 |
| T35 | 行业周刊 | underline | index-row | soft-fill | compact | normal | #2D5B45 | #EEF1F2 | #6B7B85 | 期刊式头部，分栏感单列，简洁卡片 |

**H. 品牌宣传**

| ID | 名称 | 标题 | 标记 | 提示 | 卡片 | 节奏 | 主色 | 浅底 | 强调 | 视觉要点 |
|---|---|---|---|---|---|---|---|---|---|---|
| T36 | 品牌蓝调 | band | short-line | soft-fill | image-first | normal | #2457C5 | #EEF3FD | #123A8F | 品牌色顶栏，章节短线，产品图卡 |
| T37 | 高级黑金 | masthead | none | gold-frame | bordered | airy | #111111 | #F7F1E3 | #C9A24B | 黑底刊头，金色细框，结论卡 |
| T38 | 清新品牌 | pill | tag | rounded-fill | rounded | normal | #2BBFA0 | #FBF8EE | #F2A88C | 浅彩标题底，圆角产品卡，轻量标签 |
| T39 | 视觉叙事 | left-large | hairline | thin-frame | image-first | airy | #3A3A3A | #FAF6EF | #8C7A66 | 大图优先，克制图注，细框正文 |
| T40 | 服务指南 | split | step | soft-fill | flow | normal | #17A2A0 | #EFF3F5 | #0E6E6D | 操作序号标题，提示色块，步骤图卡 |

实现说明：表中"视觉要点"为设计意图；`textMuted`、`onPrimary`、`text` 在 token 文件中由设计者按对比度规则补齐。通过的对比度检查（WCAG 比值）由自动测试执行：`text`/`tint`≥7、`textMuted`/`tint`≥4.5、`onPrimary`/`primary`≥4.5、`accent` 用作文字时对其底色≥4.5。

### 6.5 各块的渲染要求（所有模板共同遵守）
- 主标题：按 `titleLayout` 渲染；超长自动换行；不使用绝对定位。
- H1/H2：H1 用于章节大标题（带 sectionMark），H2 用于小节标题（弱化版 mark）；数字类 mark 由渲染器按 H1 出现顺序自动编号（编号不存入文章数据，因此增删块不会出现错号）。
- paragraph：`text-align:justify` 不使用（两端对齐在公众号易出现空隙），采用左对齐；首行不缩进，除 T03/T18 使用 2 字缩进。
- callout：按 `calloutStyle`；背景色必须为纯色。
- quote：使用模板的引用样式（由 `calloutStyle` 派生，细框或左线），附 `cite`。
- list：有序/无序均用 `section`+文本前缀（"1." / "•"）实现，不用 `ul/ol`，避免公众号重置列表样式。
- divider：1px 实线或点线，颜色取 `primary` 与 50% 白混合（预先算好的十六进制值）。
- image：`display:block; width:100%; height:auto`；caption 居中、13px、`textMuted`。
- imageCard：按 `cardStyle`；标题可选；缺失字段时不渲染对应元素而不留空白。
- 空文章/空块：不渲染空标签。

### 6.6 模板质量标准（上线门槛）
- 每套通过 §10.2：3 篇标准样张 × 3 种宽度的截图回归，无横向溢出（`scrollWidth ≤ clientWidth`）、无文本遮挡、对比度合格。
- 不依赖外部字体、JS、SVG、渐变、阴影、`position`/`float`/`flex`（用 `display:block|inline-block` 与 `table` 以外的简单盒模型）。
- 仅通过全部自动测试**并**完成真实公众号粘贴回归的模板，才可置 `status:'available'`。

---

## 7. 模板推荐（FR-05）

### 7.1 输入特征（前端从 Article 提取，确定性）
- `contentType`：基于关键词词典（科技/商务/教育/生活/活动/新闻/品牌，每类 30–60 词）对标题+正文打分，取最高类；最高分 <阈值则为 `general`。词典存于 `packages/recommender/dict.ts`，可迭代。
- `lengthBucket`：字数 <800 short，800–1800 medium，>1800 long。
- `imageCount`：image 与 imageCard 块数量。
- `h1Count`/`h2Count`、`hasList`、`hasQuote`。
- 模式为 `raw` 时同样推荐。

### 7.2 评分
`score(T) = 0.45·categoryMatch + 0.20·lengthFit + 0.20·imageFit + 0.15·headingFit`
- `categoryMatch`：模板系列与 contentType 的映射匹配度（精确=1，相邻=0.5，其他=0.2；`general` 时全部 0.5）。映射：A 极简阅读↔general/生活/商务，B↔科技，C↔商务，D↔教育，E↔生活，F↔活动，G↔新闻，H↔品牌。
- `lengthFit`：模板 `fit.lengths` 包含当前 bucket=1，否则 0.4。
- `imageFit`：`imageCount` 为 0→偏好 imageAffinity 低的模板（1 − affinity/3）；≥4→偏好高 affinity（affinity/3）；其余 0.7。
- `headingFit`：按 `h1Count+h2Count` 与 `headingAffinity` 的接近程度。

### 7.3 选取 3 套
1. 对每个系列取得分最高的模板作为系列代表。
2. 系列代表按得分降序，取前 3 个（必来自 3 个不同系列）。
3. 得分并列：模板 ID 升序。
4. 若可用模板不足（不可能，系列数 8>3）则报错。
5. 同一输入必得同一输出（纯函数，需测试）。

### 7.4 推荐说明
规则模板生成："内容偏{类型}、{长度}、含{n}张图，适合{风格标签}"。可选：AI 改写为更自然的一句话（`POST /api/templates/recommend/explain`，超时 8 秒，失败回退规则文案）；该 AI 调用不阻塞展示推荐结果。

### 7.5 触发时机
首次生成/排版完成后推荐一次；用户编辑内容不自动改变推荐；提供"重新推荐"按钮；用户手动选择非推荐模板后，右栏仍显示推荐 3 套并高亮当前选择。

---

## 8. 渲染与微信富文本复制

### 8.1 渲染器接口（共享包 `renderer`）
```ts
renderArticle(article: Article, template: TemplateMeta, assets: Map<string, Asset>,
              opts: { mode: 'preview' | 'wechat'; width?: number }): { html: string; text: string; images: ImageRef[] }
```
纯函数，无 DOM 依赖（可在 Node 与浏览器运行，便于测试与截图）。

### 8.2 HTML 白名单
- 标签：`section`、`p`、`span`、`strong`、`br`、`img`。不使用 `h1-h6/ul/ol/li/table/div/style/script/link/iframe/svg/video/a`（链接 MVP 不支持）。
- 全部样式内联（`style` 属性）。
- CSS 属性白名单：`color`、`background-color`、`font-size`、`font-weight`、`font-family`、`line-height`、`letter-spacing`、`text-align`、`text-indent`、`margin*`、`padding*`、`border`、`border-left|right|top|bottom`、`border-style|color|width`、`border-radius`、`width`、`max-width`、`height`（仅 `auto`）、`display`（`block|inline-block`）、`box-sizing`、`vertical-align`、`word-break`、`white-space`（仅 `pre-wrap` 用于保留用户段内换行）。
- 禁止：`position`、`float`、`flex`/`grid`、`gradient`、`box-shadow`、`transform`、`animation`、`background-image`、`opacity<1`（用预先混合的纯色替代）、`calc()`、CSS 变量、`@media`。
- 白名单由 `renderer` 内 `sanitize` 模块统一强制，并有单元测试：任何超出白名单的属性输出即测试失败。

### 8.3 安全
- 所有用户文本经 HTML 转义（`& < > " '`）；`runs` 的 color 通过 ColorKey 映射，不接受自由字符串。
- 图片 `src` 只允许 `https:`（服务端 asset URL）或预览模式下的 `blob:`/`data:`；其他协议丢弃并标记 broken。
- 不使用 `innerHTML` 拼接未转义内容；预览使用 sandbox iframe。
- 输出前对最终 HTML 再次做白名单扫描（防御深度）。

### 8.4 图片可粘贴性
| 状态 | 含义 | 处理 |
|---|---|---|
| `ok` | 图片 URL 为公网 https 且阶段 1 验证"公众号可接收" | 正常输出 `<img>` |
| `needs-manual` | URL 非公网（localhost/内网）或验证表明会丢失 | 复制 HTML 中仍输出 `<img>`（便于对位），在 P04 清单标记"需手动补图"，提供下载原图 |
| `broken` | 资源已过期/加载失败 | 输出占位文字"[图片待补充：{caption}]"，P04 提醒并提供重新上传 |

阶段 1 必须用真实公众号后台实测并写入 `docs/compat-notes.md`：①`<img src=https://...>` 粘贴后是否转存；②`data:` 图片是否保留；③带 `Referer` 限制的影响。若结论为"外链图片不可用"，则采用 plan.md 中的备选方案（复制后引导用户在公众号内逐张替换，并按顺序提供图片下载包）。**不得声称无损复制图片。**

### 8.5 复制流程
1. 校验：文章非空；标题 >64 字时仍允许复制但提示。
2. 调用 `renderArticle(...,{mode:'wechat'})`，得到 `html` 与 `text`。
3. HTTPS/localhost 优先调用 `navigator.clipboard.write([new ClipboardItem({'text/html': Blob, 'text/plain': Blob})])`。由用户点击触发。
4. 普通 HTTP、接口不可用或写入失败时，选中临时富文本容器，通过 `document.execCommand('copy')` 与 `copy` 事件写入同一份 HTML；完成后清理容器、监听器并恢复焦点与选区。两种方式均失败才显示 P04 失败态，权限错误单独提示。
5. 成功后展示 P04 成功态与图片清单；同时记录本次复制的模板 ID 与块统计（仅本地，不上传）。
6. 重试仍复制 HTML 排版；`text/plain` 仅作为同一剪贴板条目的兼容表示，不设单独的纯文本复制按钮。
7. `text`（纯文本）：标题、各块文本按顺序，块间空行，图片位置以"[图片：说明]"表示。

### 8.6 兼容目标
| 模块 | 必须保留 | 不承诺 |
|---|---|---|
| 文字/标题 | 内容、加粗、字号、颜色、层级 | 字体字形一致 |
| 边框 | 边线、内边距、圆角（若微信保留） | 阴影、复杂装饰 |
| 背景块 | 纯色底、块内文字顺序 | 渐变、透明叠加 |
| 图文卡片 | 单列顺序与边框结构 | 外部图片自动转存 |

---

## 9. 后端接口

### 9.1 AI 服务与模型获取

- 创作页和编辑页提供“AI 服务”入口。填写 URL 与 API Key 后，从服务端请求上游 `GET /models`，展示去重、排序后的模型 ID；优先保留当前模型，否则默认第一项，保存前可选择其他模型。
- URL 支持 API 根路径或完整的 `/models`、`/responses`、`/chat/completions` 地址；仅填写域名时补 `/v1`。更换服务 URL 后必须重新填写密钥；同一 URL 可留空沿用已有密钥。
- 获取模型和保存配置失败时保留原配置及文章草稿，展示可重试的错误。更改 URL 或密钥后旧模型列表立即失效；保存时服务端重新获取列表并校验所选模型。
- 配置保存在服务端 `.local/ai-config.json`，重启后恢复；优先于环境变量。状态接口仅返回 URL、模型列表、当前模型及是否存在密钥，绝不回传密钥；浏览器不将密钥存入草稿或本地存储。
- 删除页面配置后恢复环境变量。环境变量已配置 URL、Key 但缺少 `AI_MODEL` 时自动获取列表并选取第一项；显式 `AI_MODEL` 保持兼容，无需上游支持模型列表。完全未配置时才使用本地示例，配置不完整或获取失败时提示错误。
- 生成请求固定使用开始时的配置，继续自动探测 Responses / Chat Completions；探测结果按 URL、密钥、模型缓存，切换配置后不复用旧结果。
- 新增接口：`POST /api/config/models`（`{baseUrl,apiKey?}`）、`POST /api/config/ai`（`{baseUrl,apiKey?,model}`）、`DELETE /api/config/ai`；配置写入仅支持同源或 `ALLOWED_ORIGIN` 指定来源。

统一约定：JSON；错误体 `{ "error": { "code": string, "message": string, "details"?: any } }`；所有响应带 `X-Request-Id`；请求体大小上限：JSON 2MB，multipart 单文件 20MB。

| 接口 | 请求 | 成功响应 | 主要错误码 |
|---|---|---|---|
| `GET /api/health` | — | `{status:'ok', version}` | — |
| `POST /api/materials/parse` | multipart：`files[]`（≤5） | `{ files:[{name, ok, text?, charCount?, error?}] }`，单文件失败 `ok:false` 但整体 200 | `TOO_MANY_FILES` `FILE_TOO_LARGE` `UNSUPPORTED_TYPE` `EXTRACT_EMPTY` `ENCRYPTED` `CORRUPT` |
| `POST /api/assets` | multipart：`file` | `{asset: Asset}` | `INVALID_IMAGE` `IMAGE_TOO_LARGE` `DIMENSION_EXCEEDED` `QUOTA_EXCEEDED` |
| `DELETE /api/assets/:id` | — | `204` | `NOT_FOUND` |
| `POST /api/articles/generate` | `{mode:'create'|'polish', topic?, text?, materials?:string[], assetIds?:string[], tone, targetLength}`（raw 模式不走此接口，由前端本地解析） | `{ article: ArticleDraft, warnings: string[], meta:{promptVersion, schemaVersion, model, latencyMs, retried:boolean} }` | `INPUT_EMPTY` `INPUT_TOO_LONG` `AI_TIMEOUT` `AI_INVALID_OUTPUT` `AI_UPSTREAM_ERROR` `RATE_LIMITED` |
| `GET /api/templates` | — | `{ version, templates: TemplateMeta[] }`（实现可为静态 JSON，等价） | — |
| `POST /api/templates/recommend/explain` | `{templateIds:string[3], features}` | `{ explanations: Record<string,string> }` | `AI_TIMEOUT`（前端回退规则文案） |

说明：
- `recommend` 与 `render/wechat` 在前端共享包实现，不设后端接口（PRD 允许，"只要输出一致"）。如后续需要服务端渲染，复用同一包。
- 客户端为 `generate` 设置 100 秒超时，支持 `AbortController` 取消。
- 限流（可配置，默认）：`generate` 10 次/分钟/IP 且并发 ≤2；`materials/parse` 20 次/分钟/IP；`assets` 60 次/分钟/IP；超限返回 429 与 `Retry-After`。
- 服务端日志：记录请求 ID、接口、耗时、错误码；**不记录素材全文和文章全文**。

---

## 10. 安全、隐私与合规

| 项 | 要求 |
|---|---|
| 密钥 | AI 密钥仅在服务端环境变量；前端包中不得出现（构建后 grep 检查） |
| 上传校验 | 扩展名+MIME+magic bytes 三重校验；文件名重命名为随机 ID，不使用原文件名做路径；目录遍历防护 |
| 文档处理 | 文档仅在内存中解析，解析后不落盘；解析设超时（15 秒）和页数上限（PDF ≤200 页） |
| 图片 | 落盘于隔离目录，随机 ID；去 EXIF；默认保留 7 天（`ASSET_TTL_DAYS`），到期清理任务每日运行；客户端保留原图 Blob，过期后可一键重新上传 |
| XSS | 见 §8.3；CSP：`default-src 'self'; img-src 'self' https: data: blob:; script-src 'self'; frame-src 'self' about:`（预览 iframe 为 srcdoc+sandbox） |
| CORS | 仅允许配置的前端源 |
| 隐私告知 | P01 声明素材将提交 AI 服务；设置页/页脚提供隐私说明；用户可"清空本地草稿并删除已上传图片"（调用 `DELETE /api/assets/:id` 逐个删除） |
| 提示词注入 | 素材放入明确分隔的"数据区"；系统提示声明数据区内的指令无效；输出仅通过 Schema 校验后的结构化数据进入系统，无法执行 |
| AI 内容标识 | 生成/润色模式的文章在编辑页顶部显示"内容由 AI 生成，请核对事实后发布"提示；不写入复制内容；正式部署前由运营确定是否需要在正文末尾加标识，并将该选项做成设置项（默认关闭） |
| 版权 | 模板为自研；不引入第三方字体/图标；依赖许可证清单入库（`THIRD_PARTY.md`） |
| 部署前待定（需运营/法务确认） | 素材存储期限最终值、用户删除机制细则、AI 内容审核规则；这些以配置项实现，不阻塞开发 |

---

## 11. 异常处理矩阵

| 场景 | 行为 |
|---|---|
| 无输入 | 禁用提交，提示"请输入主题或上传/粘贴素材" |
| 主题 <5 字符且无素材 | 同上，提示"主题至少 5 个字符" |
| 文本超 30,000 字 | 红色提示，禁用提交，指出超出字数 |
| 扫描 PDF/加密/损坏 | 该文件标红，提示"无法读取文本，请粘贴文字"，不送 AI |
| 文件数量/大小超限 | 拒绝超限项并提示限制，其余保留 |
| 图片损坏/超限/格式不符 | 拒绝该图，保留其他资料 |
| AI 超时/无效输出 | 自动重试 1 次；仍失败显示具体原因和"重试"按钮；输入与已编辑文章保留 |
| 429 限流 | 显示"请求过于频繁，请 N 秒后重试"并倒计时 |
| 网络中断 | 编辑/预览/复制照常（图片需网络除外）；生成、上传提示"网络中断，内容已保留" |
| 原文一致性检测失败 | 阻止自动进入编辑页，显示差异，用户可二次确认继续 |
| 剪贴板权限被拒/不支持 | P04 失败态，提供纯文本备选 |
| 本地存储满 | 提示清理并允许导出 JSON |
| 图片已过期 | 预览占位+"重新上传"；复制时标记 broken |
| 超长标题/内容 | 自动换行；禁止横向溢出和遮挡 |
| 切换模板 | 保留所有文字、图片顺序与人工修改 |
| 页面意外刷新 | 启动时提示恢复草稿 |

---

## 12. 非功能要求

- **性能**：模板目录首次加载 ≤3 秒（缩略图懒加载、JSON 压缩）；2000 字+5 图文章切换模板后预览更新 ≤1 秒；编辑输入延迟无明显卡顿（块列表虚拟化不强制，块数 ≤120）。
- **兼容性**：Chrome、Edge 桌面版最新两个大版本；不支持移动端编辑。
- **可访问性**：键盘可操作主要流程；焦点可见；表单错误关联到字段；缩略图有 alt 文本。
- **可观测性**：前端记录（本地）生成耗时、失败率；服务端记录 AI 延迟、重试率、错误码分布。
- **可维护性**：Schema、模板、渲染共享包有 ≥80% 单元测试覆盖（行覆盖）。
- **国际化**：仅简体中文，文案集中管理以便后续替换。

---

## 13. 验收标准

### 13.1 功能验收（沿用 PRD A01–A10，补充测试方法）

| ID | 测试动作 | 通过标准 | 方式 |
|---|---|---|---|
| A01 | 仅输入主题，素材创作 | 生成结构完整、可编辑文章；含主标题、≥2 个 heading、≥4 个 paragraph | E2E（mock AI）+ 手动（真实 AI） |
| A02 | 上传正常 DOCX、可提取 PDF；上传扫描 PDF、加密 PDF、改后缀文件 | 正确提取；错误文件明确提示且其他文件不受影响 | 集成测试 + 样例文件集 |
| A03 | 原文排版+切换模板 | 一致性检测通过；字符、标点、段落顺序不变 | 单元+E2E |
| A04 | 生成后改标题、段落、图片；刷新 | 预览同步更新；刷新后恢复 | E2E |
| A05 | 打开模板库 | 恰好 40 套 available；缩略图与预览一致 | 自动 |
| A06 | 获取推荐 | 3 套、3 个不同系列、同输入同输出 | 单元 |
| A07 | 连续切换 40 套模板 | 文章 JSON 深比较不变；无 AI 请求发出 | E2E（断言网络） |
| A08 | 3 样张×320/375/414 | 无横向溢出、无遮挡 | Playwright 自动 |
| A09 | Chrome/Edge 点击复制 | 剪贴板同时含 text/html 与 text/plain；成功/失败提示准确 | Playwright(Chromium)+ 手动 Edge |
| A10 | 真实公众号后台粘贴→保存草稿→重开 | 文字不丢；标题/边框/背景块可读；图片异常有明确处理 | 手动，记录于 `docs/compat-report.md` |

### 13.2 模板批量测试
- 40 套 × 3 篇标准样张（纯文字长文 / 多层级标题 / 含图片+背景卡片）× 3 种宽度 = 360 张截图，作为视觉基线（Playwright 截图对比，阈值 0.2% 像素差，基线更新需人工审核）。
- 自动检查项：横向溢出、对比度、HTML 白名单、空标签、重复 ID、文本完整性（渲染后可见文字拼接 = 文章文字拼接）。
- 40 套模板在 Chrome 与 Edge 各做一次真实公众号粘贴回归（含图文卡片模板的图片检查），结果记入 `docs/compat-report.md` 表格（模板×浏览器×通过/问题）。任一问题未关闭的模板不得置 available。

### 13.3 标准样张（固定数据，入库 `packages/fixtures`）
1. `long-text`：约 2000 字，1 个 H1 无 H2，纯 paragraph + 少量加粗。
2. `many-headings`：约 1200 字，3 个 H1、6 个 H2，含 list、quote、callout、divider。
3. `with-images`：约 1000 字，5 张图（含 1 张超宽图、1 张竖图），含 imageCard、callout。
并包含边界样张：超长标题（64 字）、超长无空格英文串、单字符段落、空 caption。

### 13.4 上线检查清单
- [ ] A01–A10 全部通过且有记录
- [ ] 40 套 available，截图基线审核完成
- [ ] 安全检查：密钥不入包、上传校验、XSS 用例、限流、CSP
- [ ] 异常矩阵 §11 逐项验证
- [ ] 第三方许可清单；隐私声明；保留期配置确认
- [ ] 已知兼容限制文档（`docs/known-limitations.md`）
- [ ] 接口文档（由 Zod/OpenAPI 生成）与部署文档

---

## 14. 交付物
可部署 Web 应用；40 套模板配置与缩略图；渲染与复制模块（共享包）；AI 文章 Schema 与提示词；接口文档；验收测试结果（`docs/compat-report.md`、截图基线）；已知限制文档；本 spec 与 plan。
