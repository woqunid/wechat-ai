import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowLeft,
  ArrowRight,
  Copy,
  FileText,
  ImagePlus,
  LayoutGrid,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Upload,
  X,
} from "lucide-react";
import { templates } from "./templates";
import { getTemplate } from "./templates";
import { renderArticle } from "./renderer";
import { copyHtml } from "./clipboard";
import { checkRawConsistency, parseRaw } from "./rawparser";
import { uid } from "./core";
import { bodyCharCount, bodyLengthStatus, CREATION_MODES, GENERATION_TIMEOUT_MS, TARGET_LENGTHS, WRITING_TONES } from "./creation.js";
import { describeTemplateFit, recommendTemplates } from "./recommender";
import { AIServiceSettings } from "./AIServiceSettings";
import { ArticleEditor } from "./ArticleEditor";
import { AIEditPanel, useAIEdit } from "./AIEditPanel";
import { ImageLinkInput } from "./ImageLinkInput";
import { clearArticleStyles, layoutSignature } from "./layout-design.js";
import {
  saveAsset,
  loadAssets,
  clearAssets,
  deleteAsset,
  saveDraft,
  loadDraft,
  saveInputs,
  loadInputs,
  saveSnapshot,
  loadSnapshot,
  clearSnapshot,
  clearDrafts,
  clearInputs,
} from "./storage";
import "./styles.css";

const API = "";
const LayoutDesigner = React.lazy(() => import('./LayoutDesigner').then(module => ({ default: module.LayoutDesigner })));
const sample = `城市正在重新定义工作方式。技术、组织与个人选择彼此交织，新的效率机会也带来了新的判断成本。\n\n真正有价值的变化，通常从一个具体问题开始：我们如何把时间留给更重要的事？`;
const blank = () => ({
  topic: "",
  text: "",
  mode: "create",
  tone: "plain",
  targetLength: 1000,
  files: [],
  images: [],
});
function parseDocumentBlocks(source, sourceBlocks) {
  const blocks = sourceBlocks.map((block) => structuredClone(block));
  let title = "";
  const first = blocks[0];
  if (first?.type === "heading" || first?.type === "paragraph") {
    const runs = first.type === "heading" ? [{ text: first.text }] : first.runs;
    let remaining = 64;
    const titleRuns = [];
    const bodyRuns = [];
    for (const run of runs) {
      const split = run.text.indexOf("\n");
      const available = split < 0 ? run.text.length : split;
      const take = Math.min(remaining, available);
      if (take) titleRuns.push({ ...run, text: run.text.slice(0, take) });
      if (take < available)
        bodyRuns.push({ ...run, text: run.text.slice(take) });
      if (split >= 0) bodyRuns.push({ ...run, text: run.text.slice(split) });
      remaining -= take;
      if (remaining <= 0) bodyRuns.push(...runs.slice(runs.indexOf(run) + 1));
      if (remaining <= 0) break;
    }
    title = titleRuns.map((run) => run.text).join("");
    if (first.type === "heading") {
      blocks.shift();
      if (bodyRuns.length)
        blocks.unshift({ id: uid("b"), type: "paragraph", runs: bodyRuns });
    } else if (bodyRuns.length) first.runs = bodyRuns;
    else blocks.shift();
  }
  const check = checkRawConsistency(source, title, blocks);
  return { title, summary: "", blocks, ...check, ignoredImages: 0 };
}
function App() {
  const [page, setPage] = useState("create");
  const [input, setInput] = useState(blank);
  const [generationInput, setGenerationInput] = useState(null);
  const [article, setArticle] = useState(null);
  const latestArticle = useRef(null);
  latestArticle.current = article;
  const [selected, setSelected] = useState("T06");
  const [assets, setAssets] = useState(new Map());
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState("");
  const [modal, setModal] = useState(null);
  const requestAbort = useRef(null);
  const [rawPending, setRawPending] = useState(null);
  const [copyFailure, setCopyFailure] = useState("general");
  const [previewWidth, setPreviewWidth] = useState(375);
  const [saved, setSaved] = useState("");
  const [savedSnapshot, setSavedSnapshot] = useState(null);
  const fileRef = useRef();
  useEffect(() => {
    loadAssets()
      .then(async (items) => {
        const checked = await Promise.all(
          items.map(async (asset) => {
            try {
              const response = await fetch(asset.cacheUrl || asset.url, { method: "HEAD" });
              return [
                asset.id,
                response.ok ? asset : { ...asset, pasteStatus: "broken" },
              ];
            } catch {
              return [asset.id, asset];
            }
          }),
        );
        setAssets(new Map(checked));
      })
      .catch(() => setToast("图片草稿无法读取"));
    Promise.all([loadDraft(), loadInputs(), loadSnapshot()])
      .then(([draft, storedInput, snapshotRecord]) => {
        if (storedInput?.input) setInput({ ...blank(), ...storedInput.input });
        if (draft?.article) {
          setArticle(draft.article);
          const sourceInput = draft.generationInput || storedInput?.input;
          setGenerationInput(sourceInput ? { ...blank(), ...sourceInput } : null);
          const recoveredSnapshot = Object.hasOwn(draft, "snapshot") ? draft.snapshot : snapshotRecord?.snapshot || null;
          setSavedSnapshot(recoveredSnapshot);
          setSelected(draft.article.templateId);
          setPage("edit");
          setModal("recover");
        }
      })
      .catch(() => {
        setToast("本地草稿读取失败");
      });
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => {
      saveInputs(input).catch(() => {
        setToast("浏览器空间不足，输入内容未能保存");
        setModal("storage-error");
      });
    }, 800);
    return () => clearTimeout(timer);
  }, [input]);
  useEffect(() => {
    if (!article) return;
    const timer = setTimeout(() => {
      saveDraft({ article, generationInput, snapshot: savedSnapshot })
        .then(() => setSaved(new Date().toLocaleTimeString()))
        .catch(() => {
          setToast("浏览器空间不足，草稿未能保存");
          setModal("storage-error");
        });
    }, 800);
    return () => clearTimeout(timer);
  }, [article, generationInput, savedSnapshot]);
  const template = getTemplate(selected);
  const saveArticleSnapshot = (snapshot) => {
    setSavedSnapshot(snapshot);
    saveSnapshot(snapshot).catch(() => {});
  };
  const recs = useMemo(
    () => (article ? recommendTemplates(article) : []),
    [article],
  );
  const enterRaw = async (parsed, source = "", sourceInput = input, templateId = "T01", resetSnapshot = true) => {
    const now = new Date().toISOString();
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(source),
    );
    const rawSourceHash = [...new Uint8Array(digest)]
      .map((x) => x.toString(16).padStart(2, "0"))
      .join("");
    setArticle({
      schemaVersion: 1,
      id: uid("article"),
      mode: "raw",
      title: parsed.title,
      summary: parsed.summary,
      blocks: parsed.blocks,
      templateId,
      settings: {},
      rawSourceHash,
      createdAt: now,
      updatedAt: now,
    });
    setGenerationInput(structuredClone(sourceInput));
    if (resetSnapshot) {
      setSavedSnapshot(null);
      clearSnapshot().catch(() => {});
    }
    setSelected(templateId);
    setPage("edit");
    setModal(null);
    setRawPending(null);
  };
  const generate = async () => {
    const mode = input.mode;
    const source =
      input.text ||
      input.files
        .filter((f) => f.ok)
        .map((f) => f.text || "")
        .join("\n\n");
    if (mode === "raw") {
      const documentFile = !input.text
        ? input.files.find((file) => file.ok && file.blocks?.length)
        : null;
      const parsed = documentFile
        ? parseDocumentBlocks(documentFile.text, documentFile.blocks)
        : parseRaw(source);
      if (parsed.mismatch) {
        setRawPending({ ...parsed, source, generationInput: structuredClone(input) });
        setModal("raw-mismatch");
        return;
      }
      await enterRaw(parsed, source);
      if (parsed.ignoredImages)
        setToast(
          `${parsed.ignoredImages} 张 Markdown 图片未导入，请在编辑器中插入原图`,
        );
      return;
    }
    const materialLength =
      input.text.length +
      input.files.reduce((n, f) => n + (f.text?.length || 0), 0);
    if (
      materialLength > (input.targetLength || 1000) * 1.2 &&
      !window.confirm(mode === "polish" ? "原文较长，润色会优先保留事实和重要细节，可能超过目标长度。是否继续？" : "素材较长，生成文章可能压缩原始信息。是否继续？")
    )
      return;
    setLoading(true);
    const submittedInput = structuredClone(input);
    requestAbort.current = new AbortController();
    try {
      const res = await fetch(API + "/api/articles/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          topic: submittedInput.topic,
          text: submittedInput.text,
          materials: submittedInput.files.filter((f) => f.ok).map((f) => f.text).filter(Boolean),
          tone: submittedInput.tone,
          targetLength: submittedInput.targetLength,
          assetIds: submittedInput.images.map((image) => image.id).filter(Boolean),
        }),
        signal: AbortSignal.any([
          requestAbort.current.signal,
          AbortSignal.timeout(GENERATION_TIMEOUT_MS + 10000),
        ]),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "生成失败");
      setArticle(data.article);
      setGenerationInput(submittedInput);
      setSelected(data.article.templateId);
      setSavedSnapshot(null);
      clearSnapshot().catch(() => {});
      setPage("edit");
      if (data.warnings?.length) setToast(data.warnings.join("；"));
    } catch (e) {
      setToast(
        e.name === "AbortError"
          ? "生成已取消"
          : e.name === "TimeoutError"
            ? "生成超时，请重试"
            : e.message || "网络中断，内容已保留",
      );
    } finally {
      requestAbort.current = null;
      setLoading(false);
    }
  };
  const cancelGeneration = () => requestAbort.current?.abort();
  const removeImage = async (id) => {
    try {
      await fetch(`/api/assets/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
    } catch {}
    await deleteAsset(id).catch(() => {});
    setAssets((m) => {
      const n = new Map(m);
      n.delete(id);
      return n;
    });
    setInput((v) => ({ ...v, images: v.images.filter((x) => x.id !== id) }));
  };
  const moveImage = (i, delta) =>
    setInput((v) => {
      const images = [...v.images],
        n = i + delta;
      if (n < 0 || n >= images.length) return v;
      [images[i], images[n]] = [images[n], images[i]];
      return { ...v, images };
    });
  const reuploadAsset = async (id) => {
    const previous = assets.get(id);
    if (!previous?.blob) {
      setToast("本地原图不可用，请重新选择文件");
      return;
    }
    const form = new FormData();
    form.append("file", previous.blob, previous.filename || "image.png");
    try {
      const response = await fetch("/api/assets", {
        method: "POST",
        body: form,
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error?.message || "图片重新上传失败");
      const next = {
        ...data.asset,
        ...(previous.sourceUrl ? { sourceUrl: previous.sourceUrl } : {}),
        url: /^https:\/\//i.test(data.asset.url) ? data.asset.url : previous.sourceUrl || new URL(data.asset.url, window.location.origin).href,
        previewUrl: URL.createObjectURL(previous.blob),
        blob: previous.blob,
      };
      await saveAsset(next, previous.blob);
      await deleteAsset(id);
      try {
        await fetch(`/api/assets/${encodeURIComponent(id)}`, {
          method: "DELETE",
        });
      } catch {}
      setAssets((current) => {
        const assets = new Map(current);
        assets.delete(id);
        assets.set(next.id, next);
        return assets;
      });
      setInput((value) => ({
        ...value,
        images: value.images.map((image) =>
          image.id === id ? { ...image, id: next.id } : image,
        ),
      }));
      setArticle((current) =>
        current
          ? {
              ...current,
              blocks: current.blocks.map((block) =>
                (block.type === "image" || block.type === "imageCard") &&
                block.assetId === id
                  ? { ...block, assetId: next.id }
                  : block,
              ),
            }
          : current,
      );
      setToast("图片已重新上传");
    } catch (error) {
      setToast(error.message);
    }
  };
  const addFiles = async (list) => {
    const allowedDocs = ["docx", "pdf", "txt", "md"];
    const allowedImages = ["jpg", "jpeg", "png", "webp"];
    let docCount = input.files.length;
    let imageCount = input.images.length;
    for (const file of [...list]) {
      const ext = file.name.toLowerCase().split(".").pop();
      if (allowedImages.includes(ext)) {
        if (file.size > 10 * 1024 * 1024) {
          setToast("图片不能超过 10MB");
          continue;
        }
        if (imageCount >= 10) {
          setToast("最多添加 10 张图片");
          continue;
        }
        const fd = new FormData();
        fd.append("file", file);
        try {
          const r = await fetch(API + "/api/assets", {
            method: "POST",
            body: fd,
          });
          const d = await r.json();
          if (!r.ok) throw new Error(d.error?.message);
          const asset = {
            ...d.asset,
            url: new URL(d.asset.url, window.location.origin).href,
            previewUrl: URL.createObjectURL(file),
            blob: file,
          };
          setAssets((m) => new Map(m).set(d.asset.id, asset));
          await saveAsset(asset, file);
          setInput((v) => ({
            ...v,
            images: [...v.images, { id: d.asset.id, name: file.name }],
          }));
          imageCount++;
        } catch (e) {
          setToast(e.message);
        }
      } else if (allowedDocs.includes(ext)) {
        if (file.size > 20 * 1024 * 1024) {
          setToast(`${file.name} 超过 20MB`);
          continue;
        }
        if (docCount >= 5) {
          setToast("最多添加 5 个文档");
          continue;
        }
        const fd = new FormData();
        fd.append("files", file);
        try {
          const r = await fetch(API + "/api/materials/parse", {
            method: "POST",
            body: fd,
          });
          const d = await r.json();
          const parsed = d.files?.[0];
          if (!parsed?.ok) throw new Error(parsed?.error || "文档解析失败");
          setInput((v) => ({
            ...v,
            files: [
              ...v.files,
              {
                name: file.name,
                text: parsed.text,
                preview: parsed.preview,
                blocks: parsed.blocks || null,
                warnings: parsed.warnings || [],
                ok: true,
              },
            ],
          }));
          if (parsed.warnings?.length) setToast(parsed.warnings.join("；"));
          docCount++;
        } catch (e) {
          setInput((v) => ({
            ...v,
            files: [
              ...v.files,
              { name: file.name, text: "", ok: false, error: e.message },
            ],
          }));
          setToast(`${file.name}：${e.message}`);
        }
      } else setToast("请选择 DOCX、PDF、TXT、MD 或常见图片格式");
    }
  };
  const copy = async (force = false) => {
    if (!article) return;
    if (article.title.length > 64 && !force) {
      setModal("long-title");
      return;
    }
    const rendered = renderArticle(article, template, assets);
    try {
      await copyHtml(rendered);
      setModal("copied");
    } catch (e) {
      setCopyFailure(e.name === "NotAllowedError" ? "permission" : "general");
      setModal("copy-error");
    }
  };
  const clear = async () => {
    for (const id of assets.keys()) {
      try {
        await fetch(`/api/assets/${encodeURIComponent(id)}`, {
          method: "DELETE",
        });
      } catch {}
    }
    await clearAssets();
    await clearDrafts();
    await clearInputs();
    setArticle(null);
    setGenerationInput(null);
    setSavedSnapshot(null);
    setInput(blank());
    setAssets(new Map());
    setPage("create");
    setToast("草稿已清空");
  };
  if (page === "create")
    return (
      <Create
        input={input}
        setInput={setInput}
        modal={modal}
        setModal={setModal}
        loading={loading}
        cancelGeneration={cancelGeneration}
        generate={generate}
        addFiles={addFiles}
        fileRef={fileRef}
        assets={assets}
        removeImage={removeImage}
        reuploadAsset={reuploadAsset}
        moveImage={moveImage}
        toast={toast}
        setToast={setToast}
      />
    );
  const regenerate = async () => {
    if (!generationInput) throw new Error("原始素材未保留，请返回创作页补充素材后生成");
    const sourceInput = generationInput;
    if (article.mode === "raw") {
      const source =
        sourceInput.text ||
        sourceInput.files
          .filter((f) => f.ok)
          .map((f) => f.text || "")
          .join("\n\n");
      const documentFile = !sourceInput.text
        ? sourceInput.files.find((file) => file.ok && file.blocks?.length)
        : null;
      const parsed = documentFile
        ? parseDocumentBlocks(documentFile.text, documentFile.blocks)
        : parseRaw(source);
      if (parsed.mismatch) {
        setRawPending({ ...parsed, source, generationInput: sourceInput, templateId: selected, isRegeneration: true, beforeArticle: article });
        setModal("raw-mismatch");
        return { pending: true };
      }
      await enterRaw(parsed, source, sourceInput, selected, false);
      return { warnings: parsed.ignoredImages ? [`${parsed.ignoredImages} 张 Markdown 图片未导入，请在编辑器中插入原图`] : [] };
    }
    const response = await fetch("/api/articles/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: article.mode,
        topic: sourceInput.topic,
        text: sourceInput.text,
        materials: sourceInput.files.filter((f) => f.ok).map((f) => f.text).filter(Boolean),
        tone: article.settings?.tone || sourceInput.tone || "plain",
        targetLength: article.settings?.targetLength || sourceInput.targetLength || 1000,
        assetIds: [...new Set(article.blocks.filter((block) => block.type === "image" || block.type === "imageCard").map((block) => block.assetId))],
        templateId: selected,
      }),
      signal: AbortSignal.timeout(GENERATION_TIMEOUT_MS + 10000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message || "重新生成失败");
    if (latestArticle.current !== article) throw new Error("生成期间正文或设置已修改，本次结果未覆盖，请重新生成");
    setArticle({ ...result.article, settings: { ...result.article.settings, accountName: article.settings?.accountName } });
    setSelected(result.article.templateId);
    return result;
  };
  const newDraft = async () => {
    for (const id of assets.keys()) {
      try {
        await fetch(`/api/assets/${encodeURIComponent(id)}`, {
          method: "DELETE",
        });
      } catch {}
    }
    await clearAssets();
    await clearDrafts();
    await clearInputs();
    setArticle(null);
    setGenerationInput(null);
    setSavedSnapshot(null);
    setInput(blank());
    setAssets(new Map());
    setPage("create");
    setModal(null);
  };
  return (
    <Edit
      savedSnapshot={savedSnapshot}
      onSnapshotSaved={saveArticleSnapshot}
      onSnapshotCleared={() => {
        setSavedSnapshot(null);
        clearSnapshot().catch(() => {});
      }}
      copyFailure={copyFailure}
      onNewDraft={newDraft}
      onRegenerate={regenerate}
      rawPending={rawPending}
      confirmRaw={async () => {
        await enterRaw(rawPending, rawPending?.source || "", rawPending?.generationInput || input, rawPending?.templateId || "T01", !rawPending?.isRegeneration);
        if (rawPending?.beforeArticle) saveArticleSnapshot(rawPending.beforeArticle);
        if (rawPending?.ignoredImages)
          setToast(
            `${rawPending.ignoredImages} 张 Markdown 图片未导入，请在编辑器中插入原图`,
          );
      }}
      article={article}
      setArticle={setArticle}
      template={template}
      selected={selected}
      setSelected={setSelected}
      recs={recs}
      assets={assets}
      setAssets={setAssets}
      previewWidth={previewWidth}
      setPreviewWidth={setPreviewWidth}
      copy={copy}
      clear={clear}
      saved={saved}
      setPage={setPage}
      setModal={setModal}
      modal={modal}
      setToast={setToast}
      toast={toast}
    />
  );
}
function Create({
  input,
  setInput,
  modal,
  setModal,
  loading,
  cancelGeneration,
  generate,
  addFiles,
  fileRef,
  assets,
  removeImage,
  reuploadAsset,
  moveImage,
  toast,
  setToast,
}) {
  const [serviceOpen, setServiceOpen] = useState(false);
  const [aiStatus, setAiStatus] = useState(null);
  const aiConfigured =
    aiStatus === null ? null : Boolean(aiStatus.aiConfigured);
  useEffect(() => {
    fetch("/api/config/status")
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok)
          throw new Error(data.error?.message || "AI 服务状态读取失败");
        setAiStatus(data);
      })
      .catch((error) =>
        setAiStatus({
          aiConfigured: false,
          configurationError: { message: error.message || "无法连接 AI 服务" },
        }),
      );
  }, []);
  const textCount =
    input.text.length +
    input.files.reduce((n, f) => n + (f.text?.length || 0), 0);
  const hasText = Boolean(
    input.text.trim() || input.files.some((f) => f.ok && f.text),
  );
  const valid =
    input.mode === "raw"
      ? Boolean(
          input.text.trim() ||
          input.files.filter((f) => f.ok && f.text).length === 1,
        )
      : input.mode === "polish"
        ? hasText
        : Boolean(input.topic.trim().length >= 5 || hasText);
  const inputError =
    textCount > 30000
      ? "素材总量超出 30,000 字"
      : input.mode === "raw" && !valid
        ? "请粘贴原文或添加一个可读取的文档"
        : input.mode === "polish" && !valid
          ? "请添加需要润色的正文或文档"
          : input.mode === "create" && !valid
            ? input.topic.trim()
              ? "主题至少需要 5 个字符"
              : "请输入主题或添加素材"
            : "";
  return (
    <main className="create-shell">
      <header className="brandbar">
        <div className="wordmark">
          <span className="mark">W</span>
          <div>
            <strong>Weave</strong>
            <small>公众号内容工作台</small>
          </div>
        </div>
        <div className="create-header-actions">
          <button
            className="privacy-settings-link"
            onClick={() => setServiceOpen(true)}
          >
            <Settings2 size={15} />
            <span>AI 服务</span>
          </button>
        </div>
      </header>
      <section className="hero">
        <div>
          <p className="eyebrow">公众号内容</p>
          <h1>新建文章</h1>
        </div>
        <div className="hero-index">
          <div className="hero-step active">
            <span className="hero-step-num">1</span>
            <span>素材与创作</span>
          </div>
          <span className="hero-step-divider"></span>
          <div className="hero-step">
            <span className="hero-step-num">2</span>
            <span>版式与精修</span>
          </div>
          <span className="hero-step-divider"></span>
          <div className="hero-step">
            <span className="hero-step-num">3</span>
            <span>核对与发布</span>
          </div>
        </div>
      </section>
      <section className="create-grid">
        <div className="input-column">
          <div className="field-block">
            <label>主题</label>
            <input
              maxLength={64}
              value={input.topic}
              onChange={(e) => setInput({ ...input, topic: e.target.value })}
              placeholder="例如：AI 如何改变小团队的工作方式"
            />
            <div className="field-meta">
              <span>{input.topic.trim().length}/64</span>
              <span>
                {inputError && input.mode === "create" && textCount <= 30000
                  ? inputError
                  : ""}
              </span>
            </div>
          </div>
          <div className="field-block">
            <label>正文与素材</label>
            <textarea
              value={input.text}
              onChange={(e) => setInput({ ...input, text: e.target.value })}
              placeholder="粘贴原文、采访记录或零散笔记…"
            />
            <div className="field-meta">
              <span className={textCount > 30000 ? "error" : ""}>
                {textCount.toLocaleString()} / 30,000
                {textCount > 30000 ? " · 已超出" : ""}
              </span>
              <button
                className="text-link"
                onClick={() => setInput({ ...input, text: sample })}
              >
                填入示例
              </button>
            </div>
            {inputError && input.mode !== "create" && (
              <div className="field-validation">{inputError}</div>
            )}
          </div>
          <div
            className="upload-row"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              addFiles(e.dataTransfer.files);
            }}
          >
            <button
              className="upload-zone"
              onClick={() => {
                fileRef.current.accept = ".docx,.pdf,.txt,.md";
                fileRef.current.click();
              }}
            >
              <Upload size={18} />
              <span>添加文档</span>
              <small>DOCX · PDF · TXT · MD</small>
            </button>
            <button
              className="upload-zone"
              onClick={() => {
                fileRef.current.accept = "image/jpeg,image/png,image/webp";
                fileRef.current.click();
              }}
            >
              <ImagePlus size={18} />
              <span>添加图片</span>
              <small>JPG · PNG · WEBP</small>
            </button>
            <input
              ref={fileRef}
              hidden
              type="file"
              multiple
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>
          {(input.files.length || input.images.length) > 0 && (
            <div className="asset-list">
              {input.files.map((f, i) => (
                <div className="asset-line" key={i}>
                  <FileText size={15} />
                  <span>{f.name}</span>
                  <small className={f.ok ? "" : "error"}>
                    {f.ok
                      ? `${f.text?.length || 0} 字`
                      : `${f.error || "解析失败"}`}
                  </small>
                  <button
                    className="asset-remove"
                    aria-label="移除文档"
                    onClick={() =>
                      setInput((v) => ({
                        ...v,
                        files: v.files.filter((_, j) => j !== i),
                      }))
                    }
                  >
                    <X size={13} />
                  </button>
                  {f.ok && f.preview && (
                    <small className="asset-preview-text">
                      {f.preview}
                      {f.warnings?.length ? ` · ${f.warnings.join("；")}` : ""}
                    </small>
                  )}
                </div>
              ))}
              {input.images.map((f, i) => (
                <div className="asset-line image-asset-line" key={f.id || i}>
                  {assets.get(f.id)?.previewUrl && (
                    <img
                      className="asset-thumb"
                      src={assets.get(f.id).previewUrl}
                      alt=""
                    />
                  )}
                  <span>{f.name}</span>
                  {assets.get(f.id)?.pasteStatus === "broken" && (
                    <button
                      className="text-link"
                      onClick={() => reuploadAsset(f.id)}
                    >
                      重新上传
                    </button>
                  )}
                  <div className="asset-controls">
                    <button
                      aria-label="上移图片"
                      disabled={i === 0}
                      onClick={() => moveImage(i, -1)}
                    >
                      <ArrowLeft size={12} />
                    </button>
                    <button
                      aria-label="下移图片"
                      disabled={i === input.images.length - 1}
                      onClick={() => moveImage(i, 1)}
                    >
                      <ArrowRight size={12} />
                    </button>
                    <button
                      className="asset-remove"
                      aria-label="移除图片"
                      onClick={() => removeImage(f.id)}
                    >
                      <X size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <aside className="settings-column">
          <div className="setting-section">
            <label>创作方式</label>
            <div className="mode-list">
              {Object.entries(CREATION_MODES).map(([id, { label: title, hint: desc }]) => (
                <button
                  className={
                    input.mode === id ? "mode-option active" : "mode-option"
                  }
                  key={id}
                  onClick={() => setInput({ ...input, mode: id })}
                >
                  <span className="radio-dot"></span>
                  <span>
                    <strong>{title}</strong>
                    <small>{desc}</small>
                  </span>
                </button>
              ))}
            </div>
          </div>
          {input.mode !== "raw" && (
            <>
              <div className="setting-section">
                <label>语气</label>
                <div className="segmented">
                  {Object.entries(WRITING_TONES).map(([id, { label }]) => (
                    <button
                      className={input.tone === id ? "selected" : ""}
                      onClick={() => setInput({ ...input, tone: id })}
                      key={id}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="setting-hint">{WRITING_TONES[input.tone]?.hint}</p>
              </div>
              <div className="setting-section">
                <label>目标长度</label>
                <div className="segmented">
                  {TARGET_LENGTHS.map((n) => (
                    <button
                      className={input.targetLength === n ? "selected" : ""}
                      onClick={() => setInput({ ...input, targetLength: n })}
                      key={n}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <p className="setting-hint">正文约 ±15%，不含主标题、摘要和图注。{input.mode === "polish" ? "润色优先保留原文事实和重要细节，不为凑字数删改信息。" : "不足时讲清已有信息，不编造事实或重复凑字数。"}</p>
              </div>
            </>
          )}
          {input.mode !== "raw" && aiStatus?.configurationError && (
            <div className="ai-config-error" role="alert">
              <span>{aiStatus.configurationError.message}</span>
              <button type="button" onClick={() => setServiceOpen(true)}>
                设置
              </button>
            </div>
          )}
          <button
            className="primary-action"
            disabled={
              !valid ||
              textCount > 30000 ||
              loading ||
              (input.mode !== "raw" && aiConfigured === null) ||
              (input.mode !== "raw" && Boolean(aiStatus?.configurationError))
            }
            onClick={generate}
          >
            {loading ? (
              <>
                <RefreshCw size={17} className="spin" />
                正在生成并检查内容
              </>
            ) : input.mode === "raw" ? (
              "开始排版"
            ) : (
              "生成文章"
            )}
            {loading ? (
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  cancelGeneration();
                }}
              >
                取消
              </span>
            ) : (
              <ArrowRight size={17} />
            )}
          </button>
          {toast && (
            <div className="inline-toast" onClick={() => setToast("")}>
              {toast}
              <X size={14} />
            </div>
          )}
        </aside>
      </section>
      {modal === "storage-error" && (
        <div className="modal-backdrop">
          <section className="small-modal">
            <span className="eyebrow">本地保存</span>
            <h2>浏览器空间不足</h2>
            <p>当前输入内容仍在本页，可导出草稿 JSON 后清理浏览器空间。</p>
            <div className="modal-buttons">
              <button className="ghost-action" onClick={() => setModal(null)}>
                继续编辑
              </button>
              <button
                className="publish-action"
                onClick={() => {
                  const url = URL.createObjectURL(
                    new Blob([JSON.stringify({ input }, null, 2)], {
                      type: "application/json",
                    }),
                  );
                  const anchor = document.createElement("a");
                  anchor.href = url;
                  anchor.download = "wechat-draft.json";
                  anchor.click();
                  URL.revokeObjectURL(url);
                  setModal(null);
                }}
              >
                导出草稿
              </button>
            </div>
          </section>
        </div>
      )}
      <AIServiceSettings
        open={serviceOpen}
        onClose={() => setServiceOpen(false)}
        onStatusChange={setAiStatus}
      />
    </main>
  );
}
const previewDocument = (html, interactive = false) => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><style>*{box-sizing:border-box}html,body{margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}p{overflow-wrap:anywhere}img{max-width:100%;height:auto}${interactive ? '[data-preview-key]{cursor:pointer;scroll-margin-top:28px}[data-preview-key].ai-proposed-change{outline:2px dashed #0284c7;outline-offset:3px}[data-preview-key]:hover{outline:1px dashed #0d9488;outline-offset:3px}[data-preview-key].preview-linked{outline:2px solid #0d9488;outline-offset:3px;animation:preview-locate 1s ease-out}@keyframes preview-locate{from{box-shadow:0 0 0 7px rgba(13,148,136,.2)}to{box-shadow:0 0 0 0 rgba(13,148,136,0)}}@media(prefers-reduced-motion:reduce){[data-preview-key].preview-linked{animation:none}}' : ''}</style></head><body>${html}</body></html>`;

function TemplateThumb({ article, template, assets, large = false }) {
  const container = useRef();
  const [scale, setScale] = useState(large ? 0.5 : 0.2);
  const html = useMemo(() => renderArticle(
    { ...article, layoutDesign: undefined, blocks: article.blocks.slice(0, 12) },
    template,
    assets,
    { mode: "preview" },
  ).html, [article, template, assets]);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      setScale(entry.contentRect.width / 375);
    });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={container}
      className={`template-mini theme-${template.seriesId}${large ? " large" : ""}`}
      aria-label={`${template.name}预览`}
      style={{ backgroundColor: template.tokens.page || "#ffffff" }}
    >
      <iframe
        className="thumb-content"
        title={`${template.name}文章缩略图`}
        srcDoc={previewDocument(html)}
        sandbox="allow-same-origin"
        tabIndex={-1}
        aria-hidden="true"
        loading="lazy"
        style={{ transform: `scale(${scale})` }}
      />
    </div>
  );
}
function Edit({
  rawPending,
  confirmRaw,
  copyFailure,
  savedSnapshot,
  onSnapshotSaved,
  onSnapshotCleared,
  onRegenerate,
  onNewDraft,
  article,
  setArticle,
  template,
  selected,
  setSelected,
  recs,
  assets,
  setAssets,
  previewWidth,
  setPreviewWidth,
  copy,
  clear,
  saved,
  setPage,
  setModal,
  modal,
  setToast,
  toast,
}) {
  const [serviceOpen, setServiceOpen] = useState(false);
  const [library, setLibrary] = useState(false);
  const [libraryView, setLibraryView] = useState("templates");
  const [libraryOriginal, setLibraryOriginal] = useState(selected);
  const [layoutTrial, setLayoutTrial] = useState(null);
  const [layoutReset, setLayoutReset] = useState(0);
  const [sideTab, setSideTab] = useState('templates');
  const resetLayoutTrial = () => { setLayoutTrial(null); setLayoutReset(value => value + 1); };
  const openLibrary = () => {
    resetLayoutTrial();
    setLibraryOriginal(selected);
    setLibraryView("templates");
    setLibrary(true);
  };
  const cancelLibrary = () => {
    setSelected(libraryOriginal);
    setLibrary(false);
  };
  const [query, setQuery] = useState("");
  const [series, setSeries] = useState("全部");
  useEffect(() => {
    if (!library) return;
    const close = (event) => {
      if (event.key === "Escape") {
        setSelected(libraryOriginal);
        setLibrary(false);
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [library, libraryOriginal, setSelected]);
  const snapshot = savedSnapshot;
  const [regenerating, setRegenerating] = useState(false);
  const aiEditor = useAIEdit({ article, setArticle, assets, disabled: library || regenerating || Boolean(layoutTrial), onApplied: resetLayoutTrial, setToast });
  const history = useRef([]);
  const future = useRef([]);
  const [historySize, setHistorySize] = useState(0);
  const [futureSize, setFutureSize] = useState(0);
  const lastArticle = useRef(article);
  const historyMove = useRef(false);
  const [account, setAccount] = useState(
    article.settings?.accountName || "我的公众号",
  );
  const [summaryOpen, setSummaryOpen] = useState(Boolean(article.summary));
  const bodyLength = TARGET_LENGTHS.includes(article.settings?.targetLength)
    ? bodyLengthStatus(article.blocks, article.settings.targetLength) : null;
  const imageInput = useRef();
  const [insertAt, setInsertAt] = useState(0);
  const [replaceBlockId, setReplaceBlockId] = useState(null);
  const [imageSource, setImageSource] = useState('local');
  useEffect(() => { if (modal === 'gallery') setImageSource('local'); }, [modal]);
  const undo = () => {
    const prev = history.current.pop();
    if (!prev) return;
    future.current.push(article);
    setFutureSize(future.current.length);
    setHistorySize(history.current.length);
    historyMove.current = true;
    setArticle(prev);
    setSelected(prev.templateId);
  };
  const redo = () => {
    const next = future.current.pop();
    if (!next) return;
    history.current.push(article);
    setHistorySize(history.current.length);
    setFutureSize(future.current.length);
    historyMove.current = true;
    setArticle(next);
    setSelected(next.templateId);
  };
  useEffect(() => {
    const key = (e) => {
      if (
        !(e.ctrlKey || e.metaKey) ||
        e.key.toLowerCase() !== "z" ||
        ["INPUT", "TEXTAREA"].includes(e.target.tagName)
      )
        return;
      e.preventDefault();
      e.shiftKey ? redo() : undo();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [article]);
  useEffect(() => {
    if (lastArticle.current !== article) {
      if (!historyMove.current) {
        history.current.push(lastArticle.current);
        if (history.current.length > 100) history.current.shift();
        future.current = [];
        setHistorySize(history.current.length);
        setFutureSize(0);
      }
      lastArticle.current = article;
      historyMove.current = false;
    }
  }, [article]);
  const iframe = useRef();
  const editorPane = useRef();
  const activeKeyRef = useRef(null);
  const pendingPreviewKey = useRef(null);
  const [activeKey, setActiveKey] = useState(null);
  const highlightPreview = (doc, key) => {
    doc?.querySelector('.preview-linked')?.classList.remove('preview-linked');
    const target = key ? doc?.querySelector(`[data-preview-key="${CSS.escape(key)}"]`) : null;
    target?.classList.add('preview-linked');
    return target;
  };
  const locateContent = (key, source) => {
    activeKeyRef.current = key;
    setActiveKey(key);
    const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    const frame = iframe.current;
    const target = highlightPreview(frame?.contentDocument, key);
    if (source === 'editor') {
      if (target) {
        frame.contentWindow.scrollTo({ top: Math.max(0, target.getBoundingClientRect().top + frame.contentWindow.scrollY - 28), behavior });
        pendingPreviewKey.current = null;
        if (window.matchMedia('(max-width: 880px)').matches) {
          window.scrollTo({ top: Math.max(0, frame.getBoundingClientRect().top + window.scrollY - 24), behavior });
        }
      } else pendingPreviewKey.current = key;
    } else {
      pendingPreviewKey.current = null;
      if (key === 'summary') setSummaryOpen(true);
      requestAnimationFrame(() => {
        const pane = editorPane.current;
        const editorTarget = pane?.querySelector(`[data-editor-key="${CSS.escape(key)}"]`);
        if (editorTarget) {
          const toolbarHeight = key.startsWith('block:') ? pane.querySelector('.document-toolbar')?.offsetHeight || 0 : 0;
          const offset = Math.max(toolbarHeight + 24, (pane.clientHeight - editorTarget.offsetHeight) / 2);
          if (pane.scrollHeight > pane.clientHeight) {
            pane.scrollTo({ top: Math.max(0, pane.scrollTop + editorTarget.getBoundingClientRect().top - pane.getBoundingClientRect().top - offset), behavior });
          } else {
            window.scrollTo({ top: Math.max(0, editorTarget.getBoundingClientRect().top + window.scrollY - 24), behavior });
          }
        }
      });
    }
  };
  const locateFromEditor = (event) => {
    const key = event.target.closest('[data-editor-key]')?.dataset.editorKey;
    if (key) locateContent(key, 'editor');
  };
  const captureFieldReference = event => {
    if (event.nativeEvent?.shiftKey) return;
    const { selectionStart, selectionEnd, value, dataset } = event.target;
    if (selectionStart === selectionEnd) return;
    aiEditor.addReference({ kind: 'text', keys: [dataset.editorKey], text: value.slice(selectionStart, selectionEnd), startOffset: selectionStart, endOffset: selectionEnd });
  };
  const aiPreview = sideTab === 'ai' && !library && !layoutTrial ? aiEditor.previewArticle : null;
  const preview = useMemo(
    () =>
      renderArticle(
        { ...(aiPreview || (layoutTrial?.signature === layoutSignature(article) ? clearArticleStyles(article) : article)), layoutDesign: library ? undefined : aiPreview ? aiPreview.layoutDesign : layoutTrial?.signature === layoutSignature(article) ? layoutTrial.design : article.layoutDesign, settings: { ...article.settings, accountName: account } },
        template,
        assets,
        { mode: "preview", interactive: true },
      ).html,
    [article, template, assets, account, library, layoutTrial, aiPreview],
  );
  useEffect(() => {
    let removeClick;
    const t = setTimeout(() => {
      if (iframe.current) {
        const frame = iframe.current;
        const previousScroll = frame.contentWindow?.scrollY || 0;
        const doc = frame.contentDocument;
        if (!doc) return;
        const previousTarget = activeKeyRef.current
          ? doc.querySelector(`[data-preview-key="${CSS.escape(activeKeyRef.current)}"]`)
          : null;
        const previousOffset = previousTarget?.getBoundingClientRect().top;
        doc.open();
        doc.write(
          previewDocument(preview, true),
        );
        doc.close();
        if (aiPreview) for (const change of aiEditor.changes) {
          if (change.key !== 'layout') doc.querySelector(`[data-preview-key="${CSS.escape(change.key)}"]`)?.classList.add('ai-proposed-change');
        }
        const target = highlightPreview(doc, activeKeyRef.current);
        const targetTop = target ? target.getBoundingClientRect().top + frame.contentWindow.scrollY : 0;
        const top = target && pendingPreviewKey.current === activeKeyRef.current
          ? targetTop - 28
          : target && previousOffset !== undefined ? targetTop - previousOffset : previousScroll;
        frame.contentWindow?.scrollTo(0, Math.max(0, top));
        pendingPreviewKey.current = null;
        const click = (event) => {
          const key = event.target.closest('[data-preview-key]')?.dataset.previewKey;
          if (key) locateContent(key, 'preview');
        };
        doc.addEventListener('click', click);
        removeClick = () => doc.removeEventListener('click', click);
      }
    }, 150);
    return () => {
      clearTimeout(t);
      removeClick?.();
    };
  }, [preview, Boolean(aiPreview)]);
  const chooseTemplate = (id) => {
    resetLayoutTrial();
    setSelected(id);
    if (!library)
      setArticle((a) => ({
        ...a,
        templateId: id,
        layoutDesign: undefined,
        updatedAt: new Date().toISOString(),
      }));
  };
  const addBlock = (type) => {
    if (article.blocks.length >= 120) { setToast("段落数量已达上限"); return; }
    const id = uid("b");
    const next =
      type === "heading"
        ? { id, type, level: 1, text: "新的章节" }
        : type === "divider"
          ? { id, type }
          : type === "quote"
            ? { id, type, runs: [{ text: "引用内容" }] }
            : type === "list"
              ? { id, type, ordered: false, items: [[{ text: "新的条目" }]] }
            : { id, type, runs: [{ text: "写下新的内容" }] };
    setArticle((a) => {
      const blocks = [...a.blocks];
      blocks.splice(Math.min(insertAt, blocks.length), 0, next);
      return { ...a, blocks };
    });
    locateContent(`block:${id}`, 'preview');
    locateContent(`block:${id}`, 'editor');
  };
  const insertionAfterSelection = () => {
    const id = activeKeyRef.current?.startsWith('block:') ? activeKeyRef.current.slice(6) : null;
    const index = article.blocks.findIndex(block => block.id === id);
    return index < 0 ? article.blocks.length : index + 1;
  };
  const filtered = templates.filter(
    (t) =>
      (series === "全部" || t.series === series) &&
      query.trim().toLowerCase().split(/\s+/).every(term =>
        `${t.id} ${t.name} ${t.series} ${t.visual} ${t.fit.description || ""} ${t.styleTags.join(" ")}`
          .toLowerCase().includes(term)),
  );
  const registerImageAsset = async asset => {
    const stored = { ...asset, previewUrl: URL.createObjectURL(asset.blob) };
    try { await saveAsset(stored, stored.blob); }
    catch (error) { URL.revokeObjectURL(stored.previewUrl); throw error; }
    setAssets(current => new Map(current).set(stored.id, stored));
  };
  const placeImageAsset = (asset, index, blockId, beforeId) => {
    const current = lastArticle.current;
    if (!current || current.id !== article.id) throw new Error('文章已切换，请重新插入图片');
    if (!blockId && current.blocks.length >= 120) throw new Error('段落数量已达上限，请先合并部分内容');
    if (!blockId && current.blocks.filter(block => block.type === 'image' || block.type === 'imageCard').length >= 10) throw new Error('最多添加 10 张图片');
    if (blockId && !current.blocks.some(block => block.id === blockId)) throw new Error('原图片已删除，请重新插入');
    const id = blockId || uid('b');
    setArticle(a => {
      if (!a || a.id !== article.id) return a;
      if (blockId) return { ...a, blocks: a.blocks.map(block => block.id === blockId ? { ...block, assetId: asset.id } : block), updatedAt: new Date().toISOString() };
      if (a.blocks.length >= 120 || a.blocks.filter(block => block.type === 'image' || block.type === 'imageCard').length >= 10) return a;
      const blocks = [...a.blocks];
      const anchor = beforeId === null ? blocks.length : blocks.findIndex(block => block.id === beforeId);
      blocks.splice(anchor >= 0 ? anchor : Math.min(index, blocks.length), 0, { id, type: 'imageCard', assetId: asset.id, caption: '' });
      return { ...a, blocks, updatedAt: new Date().toISOString() };
    });
    setReplaceBlockId(null);
    return id;
  };
  const uploadImage = async (
    file,
    index = article.blocks.length,
    blockId = null,
    beforeId = undefined,
  ) => {
    if (!file) return;
    if (!blockId && article.blocks.length >= 120) { setToast("段落数量已达上限，请先合并部分内容"); return; }
    if (
      !blockId &&
      article.blocks.filter(
        (block) => block.type === "image" || block.type === "imageCard",
      ).length >= 10
    ) {
      setToast("最多添加 10 张图片");
      return;
    }
    const fd = new FormData();
    fd.append("file", file);
    try {
      const r = await fetch("/api/assets", { method: "POST", body: fd });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error?.message);
      const asset = {
        ...d.asset,
        url: new URL(d.asset.url, window.location.origin).href,
        blob: file,
      };
      await registerImageAsset(asset);
      return placeImageAsset(asset, index, blockId, beforeId);
    } catch (e) {
      setToast(e.message);
    }
  };
  const requestRegenerate = () => setModal("regen");
  const confirmRegen = async () => {
    const previous = article;
    setModal(null);
    setRegenerating(true);
    try {
      const result = await onRegenerate();
      if (!result?.pending) {
        onSnapshotSaved?.(previous);
        setToast(result?.warnings?.length ? result.warnings.join("；") : "文章已重新生成");
      }
    } catch (e) {
      setToast(e.message || "重新生成失败");
    } finally {
      setRegenerating(false);
    }
  };
  const original = () => {
    setPage("create");
  };
  return (
    <div className="edit-shell">
      <header className="edit-topbar">
        <button className="back-button" onClick={original}>
          <ArrowLeft size={17} />
          <span>创作</span>
        </button>
        <div className="edit-brand">
          <span className="mark small">W</span>
          <strong>Weave</strong>
          <span className="draft-status">
            <i></i>
            {saved ? `已保存 ${saved}` : "保存中"}
          </span>
        </div>
        <div className="top-actions">
          <button
            className="icon-action"
            title="AI 服务设置"
            onClick={() => setServiceOpen(true)}
          >
            <Settings2 size={16} />
          </button>
          <button className="ghost-action" onClick={() => setModal("clear")}>
            清空草稿
          </button>
          <button className="publish-action" disabled={Boolean(layoutTrial || aiPreview)} title={layoutTrial || aiPreview ? '应用当前方案后再复制' : undefined} onClick={() => copy()}>
            <Copy size={16} />
            复制到公众号
          </button>
        </div>
      </header>
      <AIServiceSettings
        open={serviceOpen}
        onClose={() => setServiceOpen(false)}
      />
      <div className="edit-workspace">
        <aside
          className="editor-pane"
          ref={editorPane}
          onClickCapture={locateFromEditor}
          onFocusCapture={locateFromEditor}
        >
          <div className="pane-heading">
            <div>
              <span className="eyebrow">编辑</span>
              <h2>正文</h2>
            </div>
            <button
              className="icon-action"
              title="新增内容"
              onClick={() => { setInsertAt(insertionAfterSelection()); setModal("add"); }}
            >
              <Plus size={18} />
            </button>
          </div>
          <div className="article-edit">
            <label>文章标题</label>
            <textarea
              className={`title-edit${activeKey === 'title' ? ' is-linked' : ''}`}
              data-editor-key="title"
              onSelect={captureFieldReference}
              onKeyUp={event => { if (event.key === 'Shift') captureFieldReference(event); }}
              maxLength={80}
              value={article.title}
              onChange={(e) =>
                setArticle((a) => ({ ...a, title: e.target.value }))
              }
            />
            <div className="field-meta">
              <span className={article.title.length > 64 ? "error" : ""}>
                {article.title.length}/64
              </span>
              <button
                className="text-link"
                onClick={() => setSummaryOpen(value => !value)}
              >
                {summaryOpen ? "收起摘要" : article.summary ? "编辑摘要" : "添加摘要"}
              </button>
            </div>
            {article.settings?.mockGenerated && (
              <div className="content-origin mock-origin">本地示例 · 未执行语气和目标长度</div>
            )}
            {(article.settings?.aiEdited || (article.settings?.aiGenerated && !article.settings?.mockGenerated)) && (
                <div className="content-origin">
                  {article.settings?.aiEdited ? '内容经 AI 修改，请核对事实后发布' : '内容由 AI 生成，请核对事实后发布'}
                </div>
              )}
            <div className="writing-status" aria-label="当前文章创作设置">
              <span>{CREATION_MODES[article.mode]?.label}</span>
              {article.mode === "raw" ? <span>{article.settings?.aiEdited ? '原文导入 · 已通过 AI 修改' : '保留原文 · 不使用 AI'}</span> : <>
                <span>{WRITING_TONES[article.settings?.tone]?.label || "通俗"}</span>
                {bodyLength && <span>目标约 {bodyLength.target} 字</span>}
              </>}
              <span title="含标点、小标题和引用出处，不计空白、主标题、摘要及图片说明">正文 {bodyLength?.actual ?? bodyCharCount(article.blocks)} 字</span>
              {article.mode !== "raw" && !article.settings?.mockGenerated && bodyLength && !bodyLength.within && <small>当前超出 {bodyLength.min}–{bodyLength.max} 字参考范围，可继续编辑</small>}
            </div>
            {article.settings?.generationWarnings?.length > 0 && <div className="writing-warnings" role="status">
              <strong>生成时提示</strong>
              {article.settings.generationWarnings.map((warning, index) => <p key={index}>{warning}</p>)}
            </div>}
            {summaryOpen && (
              <textarea
                className={`summary-edit${activeKey === 'summary' ? ' is-linked' : ''}`}
                data-editor-key="summary"
                onSelect={captureFieldReference}
                onKeyUp={event => { if (event.key === 'Shift') captureFieldReference(event); }}
                value={article.summary || ""}
                maxLength={120}
                placeholder="摘要"
                onChange={(e) =>
                  setArticle((a) => ({ ...a, summary: e.target.value }))
                }
              />
            )}
            <div className="block-toolbar">
              <span>{article.blocks.length} 个内容段落</span>
              <span className="history-tools">
                <button
                  onClick={undo}
                  disabled={!historySize}
                  title="撤销 Ctrl+Z"
                >
                  撤销
                </button>
                <button
                  onClick={redo}
                  disabled={!futureSize}
                  title="重做 Ctrl+Shift+Z"
                >
                  重做
                </button>
              </span>
              <button
                className="insert-image"
                onClick={() => {
                  setInsertAt(insertionAfterSelection());
                  setReplaceBlockId(null);
                  setModal("gallery");
                }}
              >
                <ImagePlus size={15} />
                插入图片
              </button>
            </div>
            <ArticleEditor
              article={article}
              setArticle={setArticle}
              template={template}
              assets={assets}
              activeKey={activeKey}
              onSelect={key => locateContent(key, 'editor')}
              onReference={aiEditor.addReference}
              onUpload={uploadImage}
              onRegisterAsset={registerImageAsset}
              onGallery={(index, blockId = null) => {
                setInsertAt(index);
                setReplaceBlockId(blockId);
                setModal('gallery');
              }}
              setToast={setToast}
            />
            <button
              className="add-block"
              onClick={() => {
                setInsertAt(article.blocks.length);
                setModal("add");
              }}
            >
              <Plus size={15} />
              添加内容块
            </button>
            <div className="article-end-actions">
              <button
                className="text-link"
                disabled={regenerating}
                onClick={requestRegenerate}
              >
                {regenerating ? (
                  <RefreshCw size={14} className="spin" />
                ) : (
                  <RefreshCw size={14} />
                )}
                重新生成
              </button>
              <button className="text-link" onClick={original}>
                返回修改素材
              </button>
              {snapshot && (
                <button
                  className="text-link"
                  onClick={() => {
                    setArticle(snapshot);
                    setSelected(snapshot.templateId);
                    onSnapshotCleared?.();
                  }}
                >
                  撤销重新生成
                </button>
              )}
            </div>
          </div>
        </aside>
        <main className="preview-pane">
          <div className="preview-toolbar">
            <span className="preview-label">{aiPreview ? 'AI修改预览 · 未应用' : layoutTrial ? '新版式试用' : '实时预览'}<small>{aiPreview ? '虚线标记修改处，应用后即可复制' : layoutTrial ? '应用后即可复制' : '点击内容，双向定位'}</small></span>
            <div className="width-switch">
              {[320, 375, 414].map((w) => (
                <button
                  className={previewWidth === w ? "on" : ""}
                  onClick={() => setPreviewWidth(w)}
                  key={w}
                >
                  {w}
                </button>
              ))}
              <button
                className={previewWidth === 720 ? "on" : ""}
                onClick={() => setPreviewWidth(720)}
              >
                宽屏
              </button>
            </div>
          </div>
          {sideTab === 'ai' && aiEditor.candidate && !aiEditor.problem && <div className="ai-edit-preview-bar"><span>{aiPreview ? '当前为候选效果，正文尚未修改' : '当前为原稿'}</span><button className="text-link" onClick={() => aiEditor.setShowCandidate(value => !value)}>{aiEditor.showCandidate ? '查看原稿' : '预览方案'}</button></div>}
          <div className="phone-stage">
            <div
              className={
                previewWidth === 720 ? "phone-frame wide" : "phone-frame"
              }
              style={{
                width:
                  previewWidth === 720 ? "min(722px,100%)" : previewWidth + 16,
              }}
            >
              <div className="phone-status">
                <span>9:41</span>
                <span>●●●　▮</span>
              </div>
              <div className="phone-nav">
                <ArrowLeft size={16} />
                <span>公众号文章</span>
                <span>···</span>
              </div>
              <div className="phone-account">
                <input
                  maxLength={64}
                  value={account}
                  onChange={(e) => {
                    setAccount(e.target.value);
                    setArticle((a) => ({
                      ...a,
                      settings: { ...a.settings, accountName: e.target.value },
                    }));
                  }}
                  aria-label="公众号名称"
                />
                <span>
                  {new Date().toLocaleDateString("zh-CN", {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}
                </span>
              </div>
              <iframe
                ref={iframe}
                title="文章实时预览"
                sandbox="allow-same-origin"
                style={{ width: previewWidth }}
              />
            </div>
          </div>
        </main>
        <aside className={`template-pane${sideTab === 'ai' ? ' ai-edit-pane' : ''}`}>
          <div className="side-panel-tabs" role="tablist" aria-label="右侧工具">
            <button id="templates-tab" role="tab" aria-selected={sideTab === 'templates'} aria-controls="templates-panel" onClick={() => setSideTab('templates')}>模板</button>
            <button id="ai-edit-tab" role="tab" aria-selected={sideTab === 'ai'} aria-controls="ai-edit-panel" onClick={() => setSideTab('ai')}>AI修改{aiEditor.references.length > 0 && <span>{aiEditor.references.length}</span>}</button>
          </div>
          <div className="side-panel-content" id="templates-panel" role="tabpanel" aria-labelledby="templates-tab" hidden={sideTab !== 'templates'}>
          <div className="pane-heading template-heading">
            <div>
              <span className="eyebrow">视觉风格</span>
              <h2>模板</h2>
            </div>
            <span className="template-total">{templates.length}</span>
          </div>
          <React.Suspense fallback={null}><LayoutDesigner key={article.id} article={article} setArticle={setArticle} onTrial={setLayoutTrial} resetKey={layoutReset} disabled={library || regenerating || Boolean(aiEditor.busy)} setToast={setToast} /></React.Suspense>
          <div className="recommend-label">
            <span>为这篇文章挑选</span>
            <small>随内容实时匹配</small>
          </div>
          <div className="recommend-list">
            {recs.map((t) => (
              <button
                key={t.id}
                onClick={() => chooseTemplate(t.id)}
                aria-pressed={selected === t.id}
                className={
                  selected === t.id ? "recommend-item active" : "recommend-item"
                }
              >
                <TemplateThumb article={article} template={t} assets={assets} />
                <span className="recommend-copy">
                  <strong>{t.name}</strong>
                  <span className="template-style-text">{t.styleTags.join(" · ")}</span>
                  <small>{t.reason}</small>
                </span>
                {selected === t.id && <span className="selected-tick">✓</span>}
              </button>
            ))}
          </div>
          <button className="all-templates" onClick={openLibrary}>
            <LayoutGrid size={16} />
            浏览全部模板
            <ArrowRight size={15} />
          </button>
          <div className="template-current">
            <span>当前使用</span>
            <strong>
              {article.layoutDesign ? article.layoutDesign.name : `${template.id} · ${template.name}`}
            </strong>
            <p>{article.layoutDesign ? article.layoutDesign.description : template.visual}</p>
            <small>{article.layoutDesign ? 'AI 定制排版 · 全文保留' : describeTemplateFit(article, template)}</small>
          </div>
          </div>
          <div className="side-panel-content ai-edit-slot" id="ai-edit-panel" role="tabpanel" aria-labelledby="ai-edit-tab" hidden={sideTab !== 'ai'}>
            <AIEditPanel editor={aiEditor} article={article} assets={assets} disabled={library || regenerating || Boolean(layoutTrial)} onLocate={key => locateContent(key, 'editor')}/>
          </div>
        </aside>
      </div>
      {library && (
        <div className="modal-backdrop library-backdrop" onClick={cancelLibrary}>
          <div className="library-modal" role="dialog" aria-modal="true" aria-labelledby="library-title" onClick={(e) => e.stopPropagation()}>
            <header>
              <div>
                <span className="eyebrow">模板库</span>
                <h2 id="library-title">为这篇文章选择版式</h2>
                <p className="library-intro">每张卡片都是当前文章的排版，点击试用并查看完整效果。</p>
              </div>
              <button className="icon-action" onClick={cancelLibrary} aria-label="关闭模板库并取消试用">
                <X size={19} />
              </button>
            </header>
            <div className="library-tools">
              <div className="search-field">
                <Search size={16} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜索名称、编号、风格或用途"
                  aria-label="搜索模板"
                  autoFocus
                />
              </div>
              <div className="series-tabs">
                {["全部", ...new Set(templates.map(t => t.series))].map((s) => (
                  <button
                    key={s}
                    className={series === s ? "selected" : ""}
                    onClick={() => setSeries(s)}
                    aria-pressed={series === s}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <div className="library-view-switch">
              <button className={libraryView === "templates" ? "selected" : ""} aria-pressed={libraryView === "templates"} onClick={() => setLibraryView("templates")}>模板列表 · {filtered.length}</button>
              <button className={libraryView === "preview" ? "selected" : ""} aria-pressed={libraryView === "preview"} onClick={() => setLibraryView("preview")}>文章预览</button>
            </div>
            <div className={`library-workspace view-${libraryView}`}>
              <div className="library-catalog">
                <div className="library-result-count">{filtered.length} 套版式 · 使用当前文章预览</div>
                <div className="library-grid">
                  {filtered.map((t) => (
                    <button
                      key={t.id}
                      className={selected === t.id ? "library-card active" : "library-card"}
                      aria-pressed={selected === t.id}
                      onClick={() => {
                        chooseTemplate(t.id);
                        setLibraryView("preview");
                      }}
                    >
                      <TemplateThumb article={article} template={t} assets={assets} large />
                      <span className="library-card-title">
                        <strong>{t.name}</strong>
                        <small>{t.id}</small>
                      </span>
                      <span className="template-tags">{t.styleTags.map(tag => <span key={tag}>{tag}</span>)}</span>
                      <small className="library-card-purpose">{t.fit.description || t.series}</small>
                      <small className="library-card-fit">{describeTemplateFit(article, t)}</small>
                      {recs.some(recommended => recommended.id === t.id) && <span className="library-recommended">适合当前文章</span>}
                    </button>
                  ))}
                  {filtered.length === 0 && (
                    <p className="empty-result">没有匹配的模板，试试其他风格或用途。</p>
                  )}
                </div>
              </div>
              <aside className="library-inspector">
                <div className="library-preview-heading" aria-live="polite">
                  <span className="eyebrow">正在试用</span>
                  <strong>{template.name}<small>{template.id}</small></strong>
                  <p>{template.visual}</p>
                  <small>{describeTemplateFit(article, template)}</small>
                </div>
                <div className="library-live-preview">
                  <iframe
                    title={`${template.name}完整文章预览`}
                    srcDoc={previewDocument(preview)}
                    sandbox="allow-same-origin"
                  />
                </div>
              </aside>
            </div>
            <footer>
              <span className="library-selection">已选 <strong>{template.name}</strong></span>
              <button className="ghost-action" onClick={cancelLibrary}>
                取消
              </button>
              <button
                className="publish-action"
                onClick={() => {
                  setArticle((a) => ({
                    ...a,
                    templateId: selected,
                    layoutDesign: undefined,
                    updatedAt: new Date().toISOString(),
                  }));
                  setLibrary(false);
                }}
              >
                使用此模板
              </button>
            </footer>
          </div>
        </div>
      )}
      {modal && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <div className="small-modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setModal(null)}>
              <X size={18} />
            </button>
            {modal === "storage-error" ? (
              <>
                <span className="eyebrow">本地保存</span>
                <h2>浏览器空间不足</h2>
                <p>当前内容仍在本页，可导出一份 JSON 草稿后清理浏览器空间。</p>
                <div className="modal-buttons">
                  <button
                    className="ghost-action"
                    onClick={() => setModal(null)}
                  >
                    继续编辑
                  </button>
                  <button
                    className="publish-action"
                    onClick={() => {
                      const payload = { article, input };
                      const url = URL.createObjectURL(
                        new Blob([JSON.stringify(payload, null, 2)], {
                          type: "application/json",
                        }),
                      );
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = "wechat-draft.json";
                      a.click();
                      URL.revokeObjectURL(url);
                      setModal(null);
                    }}
                  >
                    导出草稿
                  </button>
                </div>
              </>
            ) : modal === "recover" ? (
              <>
                <span className="eyebrow">未完成的文章</span>
                <h2>继续上次编辑？</h2>
                <div className="modal-buttons">
                  <button className="ghost-action" onClick={onNewDraft}>
                    新建文章
                  </button>
                  <button
                    className="publish-action"
                    onClick={() => setModal(null)}
                  >
                    继续编辑
                  </button>
                </div>
              </>
            ) : modal === "gallery" ? (
              <>
                <span className="eyebrow">图片素材</span>
                <h2>{replaceBlockId ? "替换图片" : "插入图片"}</h2>
                <div className="image-source-tabs" role="tablist" aria-label="图片来源">
                  <button role="tab" aria-selected={imageSource === 'local'} onClick={() => setImageSource('local')}>本地图片</button>
                  <button role="tab" aria-selected={imageSource === 'link'} onClick={() => setImageSource('link')}>图片链接</button>
                </div>
                {imageSource === 'link' ? <ImageLinkInput replacing={Boolean(replaceBlockId)} onInsert={async asset => {
                  await registerImageAsset(asset);
                  return placeImageAsset(asset, insertAt, replaceBlockId);
                }} onDone={id => {
                  setModal(null);
                  locateContent(`block:${id}`, 'preview');
                  locateContent(`block:${id}`, 'editor');
                }}/> : <>
                <div className="asset-gallery">
                  {[...assets.values()].map((asset) => (
                    <button
                      key={asset.id}
                      onClick={() => {
                        if (!replaceBlockId && article.blocks.length >= 120) { setToast("段落数量已达上限，请先合并部分内容"); return; }
                        if (!replaceBlockId && article.blocks.filter(block => block.type === "image" || block.type === "imageCard").length >= 10) { setToast("最多添加 10 张图片"); return; }
                        const id = replaceBlockId || uid("b");
                        if (replaceBlockId) {
                          setArticle((a) => ({
                            ...a,
                            blocks: a.blocks.map((block) =>
                              block.id === replaceBlockId
                                ? { ...block, assetId: asset.id }
                                : block,
                            ),
                          }));
                          setReplaceBlockId(null);
                        } else
                          setArticle((a) => {
                            const blocks = [...a.blocks];
                            blocks.splice(
                              Math.min(insertAt, blocks.length),
                              0,
                              {
                                id,
                                type: "imageCard",
                                assetId: asset.id,
                                caption: "",
                              },
                            );
                            return { ...a, blocks };
                          });
                        setModal(null);
                        locateContent(`block:${id}`, 'preview');
                        locateContent(`block:${id}`, 'editor');
                      }}
                    >
                      <img src={asset.previewUrl || asset.url} alt="" />
                      <span>{asset.filename || asset.id}</span>
                    </button>
                  ))}
                  {assets.size === 0 && <p>还没有可用图片</p>}
                </div>
                <button
                  className="text-link"
                  onClick={() => imageInput.current?.click()}
                >
                  <ImagePlus size={15} />
                  上传新图片
                </button>
                <input
                  ref={imageInput}
                  hidden
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    const blockId = replaceBlockId;
                    e.target.value = "";
                    if (!file) return;
                    setModal(null);
                    uploadImage(file, insertAt, blockId).then(id => {
                      if (!id) return;
                      locateContent(`block:${id}`, 'preview');
                      locateContent(`block:${id}`, 'editor');
                    });
                  }}
                />
                </>}
                <div className="modal-buttons">
                  <button
                    className="ghost-action"
                    onClick={() => setModal(null)}
                  >
                    取消
                  </button>
                </div>
              </>
            ) : modal === "add" ? (
              <>
                <span className="eyebrow">继续组织文章</span>
                <h2>添加内容</h2>
                <div className="add-options">
                  {[
                    ["paragraph", "正文段落"],
                    ["heading", "一级标题"],
                    ["callout", "提示框"],
                    ["quote", "引用"],
                    ["list", "要点列表"],
                    ["divider", "分隔线"],
                  ].map(([type, label]) => (
                    <button
                      onClick={() => {
                        addBlock(type);
                        setModal(null);
                      }}
                      key={type}
                    >
                      {label}
                      <ArrowRight size={15} />
                    </button>
                  ))}
                </div>
              </>
            ) : modal === "raw-mismatch" ? (
              <>
                <span className="eyebrow">原文校对</span>
                <h2>检测到结构识别差异</h2>
                <p>
                  源文：{rawPending?.difference?.source || "无"}
                  <br />
                  识别后：{rawPending?.difference?.parsed || "无"}
                </p>
                <div className="modal-buttons">
                  <button
                    className="ghost-action"
                    onClick={() => setModal(null)}
                  >
                    返回编辑
                  </button>
                  <button className="publish-action" onClick={confirmRaw}>
                    仍然继续
                  </button>
                </div>
              </>
            ) : modal === "regen" ? (
              <>
                <span className="eyebrow">重新生成</span>
                <h2>替换当前正文？</h2>
                <p>重新生成会替换当前正文，当前编辑内容会保留为恢复点。</p>
                <div className="modal-buttons">
                  <button
                    className="ghost-action"
                    onClick={() => setModal(null)}
                  >
                    继续编辑
                  </button>
                  <button className="publish-action" onClick={confirmRegen}>
                    确认重新生成
                  </button>
                </div>
              </>
            ) : modal === "clear" ? (
              <>
                <span className="eyebrow">清空草稿</span>
                <h2>删除当前文章草稿？</h2>
                <div className="modal-buttons">
                  <button
                    className="ghost-action"
                    onClick={() => setModal(null)}
                  >
                    取消
                  </button>
                  <button className="danger-action" onClick={clear}>
                    清空草稿
                  </button>
                </div>
              </>
            ) : modal === "copied" ? (
              <>
                <span className="eyebrow success-eyebrow">已复制</span>
                <h2>HTML 排版已复制</h2>
                <p>请在 135 编辑器或公众号后台粘贴，并检查版式与图片。</p>
                <ol>
                  <li>打开 135 编辑器或公众号图文编辑器</li>
                  <li>在正文区域按 Ctrl+V 粘贴内容</li>
                  <li>检查版式与图片后保存</li>
                </ol>
                <div className="image-checks">
                  {article.blocks
                    .filter((b) => b.type === "image" || b.type === "imageCard")
                    .map((b) => (
                      <div key={b.id}>
                        <span>{b.caption || "文章图片"}</span>
                        {assets.get(b.assetId)?.previewUrl && (
                          <img
                            className="copy-image-thumb"
                            src={assets.get(b.assetId).previewUrl}
                            alt=""
                          />
                        )}
                        <small>
                          {assets.get(b.assetId)?.pasteStatus === "broken"
                            ? "资源已过期，需重新上传"
                            : "需手动检查"}
                        </small>
                        {assets.get(b.assetId)?.pasteStatus === "broken" && (
                          <button
                            className="text-link"
                            onClick={() => {
                              const source = assets.get(b.assetId)?.blob;
                              if (source)
                                uploadImage(
                                  source,
                                  article.blocks.findIndex(
                                    (block) => block.id === b.id,
                                  ),
                                  b.id,
                                );
                            }}
                          >
                            重新上传
                          </button>
                        )}
                        <a
                          href={
                            assets.get(b.assetId)?.previewUrl ||
                            assets.get(b.assetId)?.url ||
                            "#"
                          }
                          download
                        >
                          下载原图
                        </a>
                      </div>
                    ))}
                </div>
                <div className="modal-buttons">
                  <button
                    className="ghost-action"
                    onClick={() => setModal(null)}
                  >
                    关闭
                  </button>
                  <button
                    className="publish-action"
                    onClick={() => {
                      setModal(null);
                      copy(true);
                    }}
                  >
                    <Copy size={14} />
                    重新复制
                  </button>
                </div>
              </>
            ) : modal === "long-title" ? (
              <>
                <span className="eyebrow">文章标题</span>
                <h2>标题超过 64 个字符</h2>
                <p>可以返回缩短标题，或继续复制。</p>
                <div className="modal-buttons">
                  <button
                    className="ghost-action"
                    onClick={() => setModal(null)}
                  >
                    继续编辑
                  </button>
                  <button className="publish-action" onClick={() => copy(true)}>
                    仍然复制
                  </button>
                </div>
              </>
            ) : modal === "copy-error" ? (
              <>
                <span className="eyebrow">复制未完成</span>
                <h2>
                  {copyFailure === "permission"
                    ? "剪贴板权限被拒绝"
                    : "HTML 排版未能复制"}
                </h2>
                <p>
                  {copyFailure === "permission"
                    ? "请允许本页访问剪贴板后重新复制。"
                    : "请重新复制；如果仍然失败，请使用 Chrome 或 Edge 桌面版重试。"}
                </p>
                <div className="modal-buttons">
                  <button
                    className="ghost-action"
                    onClick={() => setModal(null)}
                  >
                    关闭
                  </button>
                  <button
                    className="publish-action"
                    onClick={() => copy(true)}
                  >
                    重新复制 HTML
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}
      {toast && (
        <div className="toast" onClick={() => setToast("")}>
          {toast}
          <X size={14} />
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
