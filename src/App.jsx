import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Copy,
  FileText,
  ImagePlus,
  LayoutGrid,
  Minus,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Trash2,
  Upload,
  WandSparkles,
  X,
} from "lucide-react";
import { templates } from "./templates";
import { getTemplate } from "./templates";
import { renderArticle } from "./renderer";
import { checkRawConsistency, parseRaw } from "./rawparser";
import { uid, blockText } from "./core";
import { recommendTemplates } from "./recommender";
import { AIServiceSettings } from "./AIServiceSettings";
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
  const [article, setArticle] = useState(null);
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
  const articleSnapshot = useRef(null);
  useEffect(() => {
    loadAssets()
      .then(async (items) => {
        const checked = await Promise.all(
          items.map(async (asset) => {
            try {
              const response = await fetch(asset.url, { method: "HEAD" });
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
        if (storedInput?.input) setInput(storedInput.input);
        if (draft?.article) {
          setArticle(draft.article);
          if (draft.snapshot || snapshotRecord?.snapshot)
            setSavedSnapshot(draft.snapshot || snapshotRecord.snapshot);
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
      saveDraft({ article, snapshot: articleSnapshot.current || null })
        .then(() => setSaved(new Date().toLocaleTimeString()))
        .catch(() => {
          setToast("浏览器空间不足，草稿未能保存");
          setModal("storage-error");
        });
    }, 800);
    return () => clearTimeout(timer);
  }, [article]);
  const template = getTemplate(selected);
  const recs = useMemo(
    () => (article ? recommendTemplates(article) : []),
    [article],
  );
  const updateBlock = (id, patch) =>
    setArticle((a) => ({
      ...a,
      blocks: a.blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)),
      updatedAt: new Date().toISOString(),
    }));
  const enterRaw = async (parsed, source = "") => {
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
      templateId: "T01",
      settings: {},
      rawSourceHash,
      createdAt: now,
      updatedAt: now,
    });
    setSelected("T01");
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
        setRawPending({ ...parsed, source });
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
      !window.confirm("素材较长，生成文章可能压缩原始信息。是否继续？")
    )
      return;
    setLoading(true);
    requestAbort.current = new AbortController();
    try {
      const res = await fetch(API + "/api/articles/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          topic: input.topic,
          text: input.text,
          materials: input.files.map((f) => f.text).filter(Boolean),
          tone: input.tone,
          targetLength: input.targetLength,
          assetIds: input.images.map((image) => image.id).filter(Boolean),
        }),
        signal: AbortSignal.any([
          requestAbort.current.signal,
          AbortSignal.timeout(100000),
        ]),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "生成失败");
      setArticle(data.article);
      setSelected(data.article.templateId);
      setSavedSnapshot(null);
      articleSnapshot.current = null;
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
        url: new URL(data.asset.url, window.location.origin).href,
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
      if (!window.isSecureContext) {
        setCopyFailure("nonsecure");
        throw new Error("secure");
      }
      if (!navigator.clipboard?.write || !window.ClipboardItem) {
        setCopyFailure("unsupported");
        throw new Error("unsupported");
      }
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([rendered.html], { type: "text/html" }),
          "text/plain": new Blob([rendered.text], { type: "text/plain" }),
        }),
      ]);
      setModal("copied");
    } catch (e) {
      if (e.name === "NotAllowedError") setCopyFailure("permission");
      else if (!["secure", "unsupported"].includes(e.message))
        setCopyFailure("general");
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
    setSavedSnapshot(null);
    articleSnapshot.current = null;
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
    if (input.mode === "raw") {
      const source =
        input.text ||
        input.files
          .filter((f) => f.ok)
          .map((f) => f.text || "")
          .join("\n\n");
      const documentFile = !input.text
        ? input.files.find((file) => file.ok && file.blocks?.length)
        : null;
      const parsed = documentFile
        ? parseDocumentBlocks(documentFile.text, documentFile.blocks)
        : parseRaw(source);
      if (parsed.mismatch) {
        setRawPending({ ...parsed, source });
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
    const response = await fetch("/api/articles/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: input.mode,
        topic: input.topic,
        text: input.text,
        materials: input.files.map((f) => f.text).filter(Boolean),
        tone: input.tone,
        targetLength: input.targetLength,
        assetIds: input.images.map((image) => image.id).filter(Boolean),
      }),
      signal: AbortSignal.timeout(100000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message || "重新生成失败");
    setArticle(result.article);
    setSelected(result.article.templateId);
    if (result.warnings?.length) setToast(result.warnings.join("；"));
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
    setSavedSnapshot(null);
    articleSnapshot.current = null;
    setInput(blank());
    setAssets(new Map());
    setPage("create");
    setModal(null);
  };
  return (
    <Edit
      savedSnapshot={savedSnapshot}
      onSnapshotCleared={() => {
        setSavedSnapshot(null);
        clearSnapshot().catch(() => {});
      }}
      copyFailure={copyFailure}
      onNewDraft={newDraft}
      onRegenerate={regenerate}
      rawPending={rawPending}
      confirmRaw={async () => {
        await enterRaw(rawPending, rawPending?.source || "");
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
      updateBlock={updateBlock}
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
              {[
                ["create", "素材创作", "从素材组织出完整文章"],
                ["polish", "素材润色", "保留事实，优化表达"],
                ["raw", "原文排版", "不改正文，只做结构识别"],
              ].map(([id, title, desc]) => (
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
                  {[
                    ["formal", "正式"],
                    ["plain", "通俗"],
                    ["lively", "活泼"],
                  ].map(([id, label]) => (
                    <button
                      className={input.tone === id ? "selected" : ""}
                      onClick={() => setInput({ ...input, tone: id })}
                      key={id}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="setting-section">
                <label>目标长度</label>
                <div className="segmented">
                  {[600, 1000, 1500, 2000].map((n) => (
                    <button
                      className={input.targetLength === n ? "selected" : ""}
                      onClick={() => setInput({ ...input, targetLength: n })}
                      key={n}
                    >
                      {n}
                    </button>
                  ))}
                </div>
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
              aiConfigured === null ||
              (input.mode !== "raw" && Boolean(aiStatus?.configurationError))
            }
            onClick={generate}
          >
            {loading ? (
              <>
                <RefreshCw size={17} className="spin" />
                正在整理素材
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
const thumbArticle = {
  title: "把问题说清楚",
  summary: "一段简洁的导语，帮助读者快速进入主题。",
  blocks: [
    { id: "thumb-h", type: "heading", level: 1, text: "从关键变化开始" },
    {
      id: "thumb-p",
      type: "paragraph",
      runs: [{ text: "把零散素材整理为清楚、易读的内容结构。" }],
    },
    {
      id: "thumb-c",
      type: "callout",
      runs: [{ text: "提炼重点，让读者知道下一步。" }],
    },
  ],
};
function TemplateThumb({ template, large = false }) {
  const html = renderArticle(thumbArticle, template, new Map(), {
    mode: "wechat",
  }).html;
  return (
    <div
      className={`template-mini theme-${template.seriesId}${large ? " large" : ""}`}
      aria-label={`${template.name}预览`}
    >
      <div
        className="thumb-content"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
function Edit({
  rawPending,
  confirmRaw,
  copyFailure,
  savedSnapshot,
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
  updateBlock,
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
  const [libraryOriginal, setLibraryOriginal] = useState(selected);
  const openLibrary = () => {
    setLibraryOriginal(selected);
    setLibrary(true);
  };
  const cancelLibrary = () => {
    setSelected(libraryOriginal);
    setLibrary(false);
  };
  const [query, setQuery] = useState("");
  const [series, setSeries] = useState("全部");
  const [snapshot, setSnapshot] = useState(savedSnapshot || null);
  const [regenerating, setRegenerating] = useState(false);
  const history = useRef([]);
  const future = useRef([]);
  const [historySize, setHistorySize] = useState(0);
  const [futureSize, setFutureSize] = useState(0);
  const lastArticle = useRef(article);
  const historyMove = useRef(false);
  const [account, setAccount] = useState(
    article.settings?.accountName || "我的公众号",
  );
  const [undoDelete, setUndoDelete] = useState(null);
  const imageInput = useRef();
  const [insertAt, setInsertAt] = useState(0);
  const [replaceBlockId, setReplaceBlockId] = useState(null);
  const [articleHeight, setArticleHeight] = useState("");
  const undo = () => {
    const prev = history.current.pop();
    if (!prev) return;
    future.current.push(article);
    setFutureSize(future.current.length);
    setHistorySize(history.current.length);
    historyMove.current = true;
    setArticle(prev);
  };
  const redo = () => {
    const next = future.current.pop();
    if (!next) return;
    history.current.push(article);
    setHistorySize(history.current.length);
    setFutureSize(future.current.length);
    historyMove.current = true;
    setArticle(next);
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
  const preview = useMemo(
    () =>
      renderArticle(
        { ...article, settings: { ...article.settings, accountName: account } },
        template,
        assets,
        { mode: "preview" },
      ).html,
    [article, template, assets, account],
  );
  useEffect(() => {
    const t = setTimeout(() => {
      if (iframe.current) {
        const frame = iframe.current;
        const previousScroll = frame.contentWindow?.scrollY || 0;
        const doc = frame.contentDocument;
        doc.open();
        doc.write(
          `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"/><style>*{box-sizing:border-box}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}p{overflow-wrap:anywhere}img{max-width:100%;height:auto}</style></head><body>${preview}</body></html>`,
        );
        doc.close();
        frame.contentWindow?.scrollTo(0, previousScroll);
      }
    }, 150);
    return () => clearTimeout(t);
  }, [preview]);
  const chooseTemplate = (id) => {
    setSelected(id);
    if (!library)
      setArticle((a) => ({
        ...a,
        templateId: id,
        updatedAt: new Date().toISOString(),
      }));
  };
  const changeType = (b, type) => {
    const text = content(b) || " ";
    const id = b.id;
    if (
      (type === "heading1" || type === "heading2") &&
      b.runs?.some((run) => run.bold)
    )
      setToast("标题不支持行内加粗，已保留文字");
    if (type === "image" || type === "imageCard") {
      const assetId = b.assetId || [...assets.keys()][0];
      if (!assetId) {
        setToast("请先上传图片");
        return;
      }
      setArticle((a) => ({
        ...a,
        blocks: a.blocks.map((x) =>
          x.id === id
            ? { id, type, assetId, caption: b.caption || "图片说明" }
            : x,
        ),
      }));
      return;
    }
    const next =
      type === "heading1"
        ? { id, type: "heading", level: 1, text }
        : type === "heading2"
          ? { id, type: "heading", level: 2, text }
          : type === "quote"
            ? { id, type, runs: [{ text }] }
            : type === "callout"
              ? { id, type, runs: [{ text }] }
              : type === "divider"
                ? { id, type }
                : type === "list"
                  ? { id, type, ordered: false, items: [[{ text }]] }
                  : { id, type: "paragraph", runs: [{ text }] };
    setArticle((a) => ({
      ...a,
      blocks: a.blocks.map((x) => (x.id === id ? next : x)),
    }));
  };
  const changeText = (b, value) => {
    if (b.type === "heading") updateBlock(b.id, { text: value });
    else if (["paragraph", "callout", "quote"].includes(b.type))
      updateBlock(b.id, { runs: [{ ...b.runs[0], text: value }] });
    else if (b.type === "list")
      updateBlock(b.id, {
        items: value
          .split("\n")
          .map((item) => item.trim())
          .filter(Boolean)
          .map((item) => [{ text: item }]),
      });
    else if (b.type === "image" || b.type === "imageCard")
      updateBlock(b.id, { caption: value });
  };
  const content = (b) =>
    b.type === "heading"
      ? b.text
      : ["paragraph", "callout", "quote"].includes(b.type)
        ? b.runs.map((r) => r.text).join("")
        : b.type === "list"
          ? b.items.map((x) => x.map((r) => r.text).join("")).join("\n")
          : b.caption || "";
  const addParagraphAfter = (index) =>
    setArticle((a) => {
      const blocks = [...a.blocks];
      blocks.splice(index + 1, 0, {
        id: uid("b"),
        type: "paragraph",
        runs: [{ text: "" }],
      });
      return { ...a, blocks };
    });
  const addBlock = (type) => {
    const id = uid("b");
    const next =
      type === "heading"
        ? { id, type, level: 1, text: "新的章节" }
        : type === "divider"
          ? { id, type }
          : type === "quote"
            ? { id, type, runs: [{ text: "引用内容" }] }
            : { id, type, runs: [{ text: "写下新的内容" }] };
    setArticle((a) => {
      const blocks = [...a.blocks];
      blocks.splice(Math.min(insertAt, blocks.length), 0, next);
      return { ...a, blocks };
    });
  };
  const move = (i, delta) =>
    setArticle((a) => {
      const blocks = [...a.blocks];
      const n = i + delta;
      if (n < 0 || n >= blocks.length) return a;
      [blocks[i], blocks[n]] = [blocks[n], blocks[i]];
      return { ...a, blocks };
    });
  const remove = (i) => {
    const b = article.blocks[i];
    setArticle((a) => ({ ...a, blocks: a.blocks.filter((_, j) => j !== i) }));
    setUndoDelete({ block: b, index: i });
    setTimeout(() => setUndoDelete(null), 5000);
  };
  const filtered = templates.filter(
    (t) =>
      (series === "全部" || t.series === series) &&
      (!query ||
        `${t.name} ${t.series} ${t.styleTags.join(" ")}`
          .toLowerCase()
          .includes(query.toLowerCase())),
  );
  const uploadImage = async (
    file,
    index = article.blocks.length,
    blockId = null,
  ) => {
    if (!file) return;
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
        previewUrl: URL.createObjectURL(file),
        blob: file,
      };
      assets.set(d.asset.id, asset);
      await saveAsset(asset, file);
      setArticle((a) => {
        const blocks = [...a.blocks];
        if (blockId) {
          const old = blocks.find((block) => block.id === blockId)?.assetId;
          const stillUsed = blocks.some(
            (block) =>
              block.id !== blockId &&
              (block.type === "image" || block.type === "imageCard") &&
              block.assetId === old,
          );
          const updated = blocks.map((block) =>
            block.id === blockId ? { ...block, assetId: d.asset.id } : block,
          );
          if (old && old !== d.asset.id && !stillUsed) {
            fetch(`/api/assets/${encodeURIComponent(old)}`, {
              method: "DELETE",
            });
            deleteAsset(old).catch(() => {});
            setAssets((current) => {
              const next = new Map(current);
              next.delete(old);
              return next;
            });
          }
          setReplaceBlockId(null);
          return { ...a, blocks: updated };
        }
        blocks.splice(Math.min(index, blocks.length), 0, {
          id: uid("b"),
          type: "imageCard",
          assetId: d.asset.id,
          caption: file.name,
        });
        return { ...a, blocks };
      });
    } catch (e) {
      setToast(e.message);
    }
  };
  const requestRegenerate = () => setModal("regen");
  const confirmRegen = async () => {
    setSnapshot(article);
    setSavedSnapshot(article);
    articleSnapshot.current = article;
    saveSnapshot(article).catch(() => {});
    setModal(null);
    setRegenerating(true);
    try {
      await onRegenerate();
      setToast("文章已重新生成");
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
          <button className="publish-action" onClick={copy}>
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
        <aside className="editor-pane">
          <div className="pane-heading">
            <div>
              <span className="eyebrow">编辑</span>
              <h2>正文</h2>
            </div>
            <button
              className="icon-action"
              title="新增内容"
              onClick={() => setModal("add")}
            >
              <Plus size={18} />
            </button>
          </div>
          <div className="article-edit">
            <label>文章标题</label>
            <textarea
              className="title-edit"
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
                onClick={() =>
                  setArticle((a) => ({
                    ...a,
                    summary: a.summary ? "" : "为读者补充一段简短导语。",
                  }))
                }
              >
                {article.summary ? "编辑摘要" : "添加摘要"}
              </button>
            </div>
            {article.settings?.mockGenerated && (
              <div className="content-origin mock-origin">本地示例内容</div>
            )}
            {article.settings?.aiGenerated &&
              !article.settings?.mockGenerated && (
                <div className="content-origin">
                  内容由 AI 生成，请核对事实后发布
                </div>
              )}
            {article.summary !== undefined && article.summary !== "" && (
              <textarea
                className="summary-edit"
                value={article.summary}
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
                  setInsertAt(article.blocks.length);
                  setReplaceBlockId(null);
                  setModal("gallery");
                }}
              >
                <ImagePlus size={15} />
                插入图片
              </button>
            </div>
            <div className="block-list">
              {article.blocks.map((b, i) => (
                <section className="edit-block" key={b.id}>
                  <div className="block-type">
                    <select
                      aria-label="内容类型"
                      value={
                        b.type === "heading" ? `heading${b.level}` : b.type
                      }
                      onChange={(e) => changeType(b, e.target.value)}
                    >
                      <option value="paragraph">正文</option>
                      <option value="heading1">一级标题</option>
                      <option value="heading2">二级标题</option>
                      <option value="callout">提示框</option>
                      <option value="quote">引用</option>
                      <option value="list">列表</option>
                      <option value="image">图片</option>
                      <option value="imageCard">图文卡片</option>
                      <option value="divider">分隔线</option>
                    </select>
                    <div>
                      <button
                        title="上移"
                        disabled={i === 0}
                        onClick={() => move(i, -1)}
                      >
                        <ChevronUp size={14} />
                      </button>
                      <button
                        title="下移"
                        disabled={i === article.blocks.length - 1}
                        onClick={() => move(i, 1)}
                      >
                        <ChevronDown size={14} />
                      </button>
                      <button
                        title="在此处插入内容"
                        onClick={() => {
                          setInsertAt(i + 1);
                          setModal("add");
                        }}
                      >
                        <Plus size={13} />
                      </button>
                      <button
                        title="在此处插入图片"
                        onClick={() => {
                          setInsertAt(i + 1);
                          setReplaceBlockId(null);
                          setModal("gallery");
                        }}
                      >
                        <ImagePlus size={13} />
                      </button>
                      <button title="删除" onClick={() => remove(i)}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                  {b.type === "divider" ? (
                    <div className="divider-preview">分隔线</div>
                  ) : b.type === "image" || b.type === "imageCard" ? (
                    <div className="image-edit-row">
                      {assets.get(b.assetId)?.previewUrl && (
                        <img src={assets.get(b.assetId).previewUrl} alt="" />
                      )}
                      <textarea
                        value={b.caption || ""}
                        placeholder="图片说明"
                        onChange={(e) =>
                          updateBlock(b.id, { caption: e.target.value })
                        }
                      />
                      <button
                        title="替换图片"
                        onClick={() => {
                          setReplaceBlockId(b.id);
                          setInsertAt(i);
                          setModal("gallery");
                        }}
                      >
                        <RefreshCw size={14} />
                      </button>
                      <button title="删除图片" onClick={() => remove(i)}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ) : (
                    <textarea
                      className={b.type === "heading" ? "heading-edit" : ""}
                      value={content(b)}
                      onChange={(e) => changeText(b, e.target.value)}
                      onKeyDown={(e) => {
                        const value = content(b);
                        if (
                          e.key === "Enter" &&
                          !e.shiftKey &&
                          e.currentTarget.selectionStart === value.length &&
                          e.currentTarget.selectionEnd === value.length
                        ) {
                          e.preventDefault();
                          addParagraphAfter(i);
                        }
                      }}
                      placeholder="编辑内容"
                    />
                  )}
                  {b.type === "quote" && (
                    <input
                      className="quote-cite-edit"
                      value={b.cite || ""}
                      placeholder="来源"
                      onChange={(e) =>
                        updateBlock(b.id, { cite: e.target.value })
                      }
                    />
                  )}
                  {["paragraph", "callout", "quote"].includes(b.type) && (
                    <div className="run-tools">
                      <button
                        onClick={() =>
                          updateBlock(b.id, {
                            runs: b.runs.map((r) => ({ ...r, bold: !r.bold })),
                          })
                        }
                      >
                        <strong>B</strong>
                      </button>
                      {["primary", "accent", "red", "orange", "green"].map(
                        (c) => (
                          <button
                            key={c}
                            title={
                              {
                                primary: "模板主色",
                                accent: "强调色",
                                red: "红色",
                                orange: "橙色",
                                green: "绿色",
                              }[c]
                            }
                            onClick={() =>
                              updateBlock(b.id, {
                                runs: b.runs.map((r) => ({ ...r, color: c })),
                              })
                            }
                          >
                            <i className={`swatch ${c}`}></i>
                          </button>
                        ),
                      )}
                    </div>
                  )}
                </section>
              ))}
            </div>
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
                    setSnapshot(null);
                    articleSnapshot.current = null;
                    onSnapshotCleared?.();
                  }}
                >
                  撤销重新生成
                </button>
              )}
            </div>
            {undoDelete && (
              <div className="undo-line">
                <span>内容块已删除</span>
                <button
                  onClick={() => {
                    setArticle((a) => ({
                      ...a,
                      blocks: [
                        ...a.blocks.slice(0, undoDelete.index),
                        undoDelete.block,
                        ...a.blocks.slice(undoDelete.index),
                      ],
                    }));
                    setUndoDelete(null);
                  }}
                >
                  撤销
                </button>
              </div>
            )}
          </div>
        </aside>
        <main className="preview-pane">
          <div className="preview-toolbar">
            <span>实时预览</span>
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
          <div className="phone-stage">
            <div
              className={
                previewWidth === 720 ? "phone-frame wide" : "phone-frame"
              }
              style={{
                width:
                  previewWidth === 720 ? "min(720px,100%)" : previewWidth + 28,
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
                style={{ width: previewWidth, height: "calc(100vh - 236px)" }}
              />
            </div>
          </div>
        </main>
        <aside className="template-pane">
          <div className="pane-heading template-heading">
            <div>
              <span className="eyebrow">视觉风格</span>
              <h2>模板</h2>
            </div>
            <span className="template-total">40</span>
          </div>
          <div className="recommend-label">
            <span>为这篇文章挑选</span>
            <button onClick={() => setToast("已根据文章内容重新匹配模板")}>
              重新推荐
            </button>
          </div>
          <div className="recommend-list">
            {recs.map((t, i) => (
              <button
                key={t.id}
                onClick={() => chooseTemplate(t.id)}
                className={
                  selected === t.id ? "recommend-item active" : "recommend-item"
                }
              >
                <TemplateThumb template={t} />
                <span className="recommend-copy">
                  <strong>{t.name}</strong>
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
              {template.id} · {template.name}
            </strong>
          </div>
        </aside>
      </div>
      {library && (
        <div className="modal-backdrop" onClick={cancelLibrary}>
          <div className="library-modal" onClick={(e) => e.stopPropagation()}>
            <header>
              <div>
                <span className="eyebrow">模板库</span>
                <h2>找到合适的阅读节奏</h2>
              </div>
              <button className="icon-action" onClick={cancelLibrary}>
                <X size={19} />
              </button>
            </header>
            <div className="library-tools">
              <div className="search-field">
                <Search size={16} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜索模板或风格"
                />
              </div>
              <div className="series-tabs">
                {[
                  "全部",
                  "极简阅读",
                  "科技资讯",
                  "商务报告",
                  "教育科普",
                  "生活方式",
                  "活动通知",
                  "新闻媒体",
                  "品牌宣传",
                ].map((s) => (
                  <button
                    key={s}
                    className={series === s ? "selected" : ""}
                    onClick={() => setSeries(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <div className="library-grid">
              {filtered.map((t) => (
                <button
                  key={t.id}
                  className={
                    selected === t.id ? "library-card active" : "library-card"
                  }
                  onClick={() => chooseTemplate(t.id)}
                >
                  <TemplateThumb template={t} large />
                  <strong>{t.name}</strong>
                  <small>
                    {recs.some((recommended) => recommended.id === t.id)
                      ? "推荐 · "
                      : ""}
                    {t.series}
                  </small>
                </button>
              ))}
              {filtered.length === 0 && (
                <p className="empty-result">没有匹配的模板</p>
              )}
            </div>
            <footer>
              <span>已选 {getTemplate(selected).name}</span>
              <button className="ghost-action" onClick={cancelLibrary}>
                取消
              </button>
              <button
                className="publish-action"
                onClick={() => {
                  setArticle((a) => ({
                    ...a,
                    templateId: selected,
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
                <div className="asset-gallery">
                  {[...assets.values()].map((asset) => (
                    <button
                      key={asset.id}
                      onClick={() => {
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
                                id: uid("b"),
                                type: "imageCard",
                                assetId: asset.id,
                                caption: "",
                              },
                            );
                            return { ...a, blocks };
                          });
                        setModal(null);
                      }}
                    >
                      <img src={asset.previewUrl} alt="" />
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
                    const blockId = replaceBlockId;
                    uploadImage(e.target.files?.[0], insertAt, blockId);
                    setModal(null);
                    e.target.value = "";
                  }}
                />
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
                <h2>富文本已复制</h2>
                <p>请在公众号后台粘贴，并检查图片。</p>
                <ol>
                  <li>打开公众号图文编辑器</li>
                  <li>在正文区域粘贴内容</li>
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
                    : copyFailure === "unsupported"
                      ? "浏览器不支持富文本复制"
                      : copyFailure === "nonsecure"
                        ? "当前页面需要 HTTPS"
                        : "当前浏览器未能写入富文本"}
                </h2>
                <p>
                  {copyFailure === "permission"
                    ? "允许本页访问剪贴板后再试，或复制纯文本。"
                    : copyFailure === "nonsecure"
                      ? "请在 HTTPS 页面打开；也可以复制纯文本。"
                      : "请使用 Chrome 或 Edge 桌面版；也可以复制纯文本。"}
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
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(
                          renderArticle(article, template, assets).text,
                        );
                        setToast("纯文本已复制，不保留排版");
                        setModal(null);
                      } catch {
                        setToast("纯文本复制失败");
                      }
                    }}
                  >
                    复制纯文本
                  </button>
                </div>
                <small>纯文本不保留排版</small>
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
