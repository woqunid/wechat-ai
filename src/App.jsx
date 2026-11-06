import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  FileText,
  History,
  ImagePlus,
  LayoutGrid,
  Plus,
  PanelRightClose,
  PanelRightOpen,
  Undo2,
  Redo2,
  RefreshCw,
  Search,
  Settings2,
  Save,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { templates, getTemplate } from "./templates";
import { renderArticle } from "./renderer";
import { copyHtml } from "./clipboard";
import { checkRawConsistency, parseRaw } from "./rawparser";
import { uid } from "./core";
import { bodyCharCount, bodyLengthStatus, CREATION_MODES, GENERATION_TIMEOUT_MS, TARGET_LENGTHS, WRITING_TONES } from "./creation.js";
import { describeTemplateFit, recommendTemplates } from "./recommender";
import { AIServiceSettings } from "./AIServiceSettings";
import { AISettingsButton } from "./AISettingsButton";
import { aiRequestOptions, loadAIPreferences, saveAIPreferences, selectedAIIsReady } from "./ai-preferences.js";
import { ArticleEditor } from "./ArticleEditor";
import { reconcileHtmlArticle } from "./document-model.js";
import { AIEditPanel, useAIEdit } from "./AIEditPanel";
import { ImageLinkInput } from "./ImageLinkInput";
import { clearArticleStyles, layoutSignature } from "./layout-design.js";
import {
  saveAsset,
  loadAssets,
  deleteAsset,
  saveDraft,
  loadDraft,
  listDrafts,
  deleteDraft,
  loadWorkspaceSession,
  saveInputs,
  loadInputs,
  listArticleHistory,
  saveArticleHistory,
  pruneArticleHistory,
} from "./storage";
import { ArticleHistory } from "./ArticleHistory";
import { AdminPage } from "./AdminPage";
import "./styles.css";

const LayoutDesigner = React.lazy(() => import('./LayoutDesigner').then(module => ({ default: module.LayoutDesigner })));
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
function WorkspaceApp() {
  const [page, setPage] = useState("create");
  const [aiPreferences, setAiPreferences] = useState(loadAIPreferences);
  const [platformStatus, setPlatformStatus] = useState(null);
  const aiConfigured = selectedAIIsReady(aiPreferences, platformStatus);
  const aiRequest = aiRequestOptions(aiPreferences);
  const updateAIPreferences = preferences => {
    saveAIPreferences(preferences);
    setAiPreferences(preferences);
  };
  const [input, setInput] = useState(blank);
  const [generationInput, setGenerationInput] = useState(null);
  const [article, storeArticle] = useState(null);
  const setArticle = React.useCallback(value => storeArticle(previous => reconcileHtmlArticle(previous, typeof value === "function" ? value(previous) : value)), []);
  const latestArticle = useRef(null);
  latestArticle.current = article;
  const [selected, setSelected] = useState("T06");
  const [assets, setAssets] = useState(new Map());
  const [loading, setLoading] = useState(false);
  const [uploads, setUploads] = useState([]);
  const uploading = useRef(false);
  const [toast, setToast] = useState("");
  const [modal, setModal] = useState(null);
  const requestAbort = useRef(null);
  const [rawPending, setRawPending] = useState(null);
  const [copyFailure, setCopyFailure] = useState("general");
  const [canvasWidth, setCanvasWidth] = useState(375);
  const [saved, setSaved] = useState("");
  const [savedSnapshot, setSavedSnapshot] = useState(null);
  const [editorSession, setEditorSession] = useState(0);
  const [ready, setReady] = useState(false);
  const [startupError, setStartupError] = useState(false);
  const [drafts, setDrafts] = useState([]);
  const [navigating, setNavigating] = useState(false);
  const navigationLock = useRef(false);
  const inputTimer = useRef(null);
  const draftTimer = useRef(null);
  const draftWrites = useRef(Promise.resolve());
  const fileRef = useRef();
  const rememberDraft = record => {
    setDrafts(values => [record, ...values.filter(value => value.id !== record.id)].sort((a, b) => b.updatedAt - a.updatedAt));
    setSaved(new Date(record.updatedAt).toLocaleTimeString());
  };
  const persistDraft = async (draft, options) => {
    const write = draftWrites.current.catch(() => {}).then(() => saveDraft(draft, options));
    draftWrites.current = write;
    const record = await write;
    rememberDraft(record);
    return record;
  };
  const storageFailure = () => {
    setSaved("");
    setToast("本地保存失败，内容仍在当前页面，请检查浏览器存储空间");
    setModal("storage-error");
  };
  useEffect(() => {
    const prune = () => {
      pruneArticleHistory().catch(() => setToast("历史记录清理失败"));
      listDrafts().then(setDrafts).catch(() => setToast("草稿列表读取失败"));
    };
    const onVisible = () => { if (document.visibilityState === "visible") prune(); };
    prune();
    const timer = setInterval(prune, 60_000);
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, []);
  useEffect(() => {
    let active = true;
    fetch("/api/config/status")
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message || "AI 服务状态读取失败");
        if (active) setPlatformStatus(data);
      })
      .catch(error => {
        if (active) setPlatformStatus({ aiConfigured: false, configurationError: { message: error.message || "无法连接 AI 服务" } });
      });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    Promise.all([listDrafts(), loadInputs(), loadWorkspaceSession(), loadAssets()])
      .then(([records, storedInput, session, items]) => {
        setAssets(new Map(items.map(asset => [asset.id, asset])));
        for (const asset of items) {
          if (!asset.cacheUrl && !asset.url) continue;
          fetch(asset.cacheUrl || asset.url, { method: "HEAD", signal: AbortSignal.timeout(10_000) })
            .then(response => {
              if (!response.ok) setAssets(current => current.get(asset.id) === asset ? new Map(current).set(asset.id, { ...asset, pasteStatus: "broken" }) : current);
            }).catch(() => {});
        }
        setDrafts(records);
        if (storedInput?.input) setInput({ ...blank(), ...storedInput.input });
        const draft = session?.page === "edit" ? records.find(record => record.id === session.articleId) : null;
        if (draft) {
          setArticle(draft.article);
          const sourceInput = draft.generationInput;
          setGenerationInput(sourceInput || null);
          setSavedSnapshot(draft.snapshot || null);
          setSelected(draft.article.templateId);
          setSaved(new Date(draft.updatedAt).toLocaleTimeString());
          setPage("edit");
        }
        setReady(true);
      })
      .catch(() => setStartupError(true));
  }, []);
  useEffect(() => {
    if (!ready || page !== "create") return;
    inputTimer.current = setTimeout(() => {
      saveInputs(input).catch(() => {
        setToast("浏览器空间不足，输入内容未能保存");
        setModal("storage-error");
      });
    }, 800);
    return () => clearTimeout(inputTimer.current);
  }, [input, ready, page]);
  useEffect(() => {
    if (!ready || page !== "edit" || !article) return;
    setSaved("");
    draftTimer.current = setTimeout(() => {
      persistDraft({ article, generationInput, snapshot: savedSnapshot }, { page: "edit" }).catch(storageFailure);
    }, 800);
    return () => clearTimeout(draftTimer.current);
  }, [article, generationInput, savedSnapshot, ready, page]);
  useEffect(() => {
    if (!ready) return;
    const flush = () => {
      if (navigationLock.current) return;
      clearTimeout(inputTimer.current);
      clearTimeout(draftTimer.current);
      if (page === "edit" && article) persistDraft({ article, generationInput, snapshot: savedSnapshot }, { page: "edit" }).catch(storageFailure);
      else saveInputs(input).catch(storageFailure);
    };
    const onHidden = () => { if (document.visibilityState === "hidden") flush(); };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHidden);
    return () => { window.removeEventListener("pagehide", flush); document.removeEventListener("visibilitychange", onHidden); };
  }, [ready, page, article, generationInput, savedSnapshot, input]);
  const template = getTemplate(selected);
  const saveArticleSnapshot = (snapshot) => {
    setSavedSnapshot(snapshot);
  };
  const enterEditor = async draft => {
    clearTimeout(inputTimer.current);
    clearTimeout(draftTimer.current);
    const next = { ...draft, article: reconcileHtmlArticle(null, draft.article) };
    await persistDraft(next, { page: "edit", clearInput: true });
    setArticle(next.article);
    setGenerationInput(next.generationInput || null);
    setSavedSnapshot(next.snapshot || null);
    setSelected(next.article.templateId);
    setInput(blank());
    setUploads([]);
    setEditorSession(value => value + 1);
    setPage("edit");
    setModal(null);
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
    const nextArticle = {
      schemaVersion: 1,
      id: resetSnapshot ? uid("article") : article.id,
      mode: "raw",
      title: parsed.title,
      summary: parsed.summary,
      blocks: parsed.blocks,
      templateId,
      settings: {},
      rawSourceHash,
      createdAt: resetSnapshot ? now : article.createdAt,
      updatedAt: now,
    };
    if (resetSnapshot) await enterEditor({ article: nextArticle, generationInput: structuredClone(sourceInput), snapshot: null });
    else setArticle(nextArticle);
    setModal(null);
    setRawPending(null);
  };
  const generate = async () => {
    if (loading || navigationLock.current) return;
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
      setLoading(true);
      try { await enterRaw(parsed, source); } catch { storageFailure(); return; }
      finally { setLoading(false); }
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
      const res = await fetch("/api/articles/generate", {
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
          ...aiRequest,
        }),
        signal: AbortSignal.any([
          requestAbort.current.signal,
          AbortSignal.timeout(GENERATION_TIMEOUT_MS + 10000),
        ]),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "生成失败");
      try { await enterEditor({ article: data.article, generationInput: submittedInput, snapshot: null }); }
      catch { storageFailure(); }
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
  const removeUnusedAssets = async (ids, removedInputs = []) => {
    let history, records;
    try { [history, records] = await Promise.all([listArticleHistory(), listDrafts()]); } catch { return; }
    const protectedIds = new Set([
      ...history.flatMap(record => record.assets.map(asset => asset.id)),
      ...records.flatMap(record => [
        ...record.article.blocks.map(block => block.assetId),
        ...(record.snapshot?.blocks || []).map(block => block.assetId),
        ...(record.generationInput?.images || []).map(image => image.id),
      ]),
      ...input.images.map(image => image.id).filter(id => !removedInputs.includes(id)),
    ]);
    for (const id of ids) {
      if (protectedIds.has(id)) continue;
      try { await fetch(`/api/assets/${encodeURIComponent(id)}`, { method: "DELETE" }); } catch {}
      await deleteAsset(id);
      setAssets(current => { const next = new Map(current); next.delete(id); return next; });
    }
  };
  const removeImage = async (id) => {
    setInput((v) => ({ ...v, images: v.images.filter((x) => x.id !== id) }));
    removeUnusedAssets([id], [id]).catch(() => setToast("图片清理失败"));
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
      await removeUnusedAssets([id], [id]);
      setAssets((current) => {
        const assets = new Map(current);
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
    if (uploading.current || !list?.length) return;
    uploading.current = true;
    const allowedDocs = ["docx", "pdf", "txt", "md"];
    const allowedImages = ["jpg", "jpeg", "png", "webp"];
    const jobs = [...list].map(file => ({ id: uid('upload'), file, status: 'pending' }));
    setUploads(current => [...current, ...jobs]);
    let docCount = input.files.length;
    let imageCount = input.images.length;
    for (const job of jobs) {
      const { file } = job;
      const finish = error => setUploads(current => error
        ? current.map(item => item.id === job.id ? { ...item, status: 'error', error } : item)
        : current.filter(item => item.id !== job.id));
      setUploads(current => current.map(item => item.id === job.id ? { ...item, status: 'uploading' } : item));
      const ext = file.name.toLowerCase().split(".").pop();
      if (allowedImages.includes(ext)) {
        if (file.size > 10 * 1024 * 1024) {
          finish("图片不能超过 10MB");
          continue;
        }
        if (imageCount >= 10) {
          finish("最多添加 10 张图片");
          continue;
        }
        const fd = new FormData();
        fd.append("file", file);
        try {
          const r = await fetch("/api/assets", {
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
          finish();
        } catch (e) {
          finish(e.message || "上传失败");
        }
      } else if (allowedDocs.includes(ext)) {
        if (file.size > 20 * 1024 * 1024) {
          finish("文档不能超过 20MB");
          continue;
        }
        if (docCount >= 5) {
          finish("最多添加 5 个文档");
          continue;
        }
        const fd = new FormData();
        fd.append("files", file);
        try {
          const r = await fetch("/api/materials/parse", {
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
          finish();
        } catch (e) {
          finish(e.message || "解析失败");
        }
      } else finish("不支持此格式");
    }
    uploading.current = false;
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
    if (navigationLock.current) return;
    navigationLock.current = true; setNavigating(true);
    clearTimeout(draftTimer.current);
    try {
      await draftWrites.current.catch(() => {});
      await deleteDraft(article.id);
      setDrafts(values => values.filter(record => record.id !== article.id));
      setArticle(null); setGenerationInput(null); setSavedSnapshot(null);
      setPage("create"); setModal(null); setToast("当前草稿已删除");
      removeUnusedAssets(assets.keys()).catch(() => {});
    } catch { storageFailure(); }
    finally { navigationLock.current = false; setNavigating(false); }
  };
  const returnToCreate = async () => {
    if (navigationLock.current) return;
    navigationLock.current = true; setNavigating(true);
    clearTimeout(draftTimer.current);
    try {
      await persistDraft({ article, generationInput, snapshot: savedSnapshot }, { page: "create" });
      setArticle(null); setGenerationInput(null); setSavedSnapshot(null);
      setPage("create"); setModal(null);
    } catch { storageFailure(); }
    finally { navigationLock.current = false; setNavigating(false); }
  };
  const openDraft = async id => {
    if (navigationLock.current) return false;
    navigationLock.current = true; setNavigating(true);
    try {
      const record = await loadDraft(id);
      if (!record) { setDrafts(await listDrafts()); throw new Error("草稿已过期或被删除"); }
      await enterEditor(record);
      return true;
    } catch (error) { setToast(error.message || "草稿打开失败"); return false; }
    finally { navigationLock.current = false; setNavigating(false); }
  };
  const removeDraft = async id => {
    if (navigationLock.current) return false;
    navigationLock.current = true; setNavigating(true);
    try {
      await deleteDraft(id);
      setDrafts(values => values.filter(record => record.id !== id));
      removeUnusedAssets(assets.keys()).catch(() => {});
      return true;
    } catch { setToast("草稿删除失败"); return false; }
    finally { navigationLock.current = false; setNavigating(false); }
  };
  const openHistory = async record => {
    if (record.expiresAt <= Date.now()) throw new Error("历史记录已过期");
    const restoredAssets = new Map(assets);
    for (const asset of record.assets) {
      let broken = Date.parse(asset.expiresAt) <= Date.now();
      try { broken = !(await fetch(asset.cacheUrl || asset.url, { method: "HEAD", signal: AbortSignal.timeout(10_000) })).ok; } catch {}
      const restored = broken
        ? { ...asset, url: undefined, cacheUrl: undefined, pasteStatus: "broken" }
        : { ...asset, previewUrl: asset.cacheUrl || asset.url };
      await saveAsset(restored);
      restoredAssets.set(asset.id, restored);
    }
    setAssets(restoredAssets);
    if (page === "edit" && article) {
      clearTimeout(draftTimer.current);
      await persistDraft({ article, generationInput, snapshot: savedSnapshot });
    }
    const previous = await loadDraft(record.id);
    await enterEditor({ article: structuredClone(record.article), generationInput: previous?.generationInput || null, snapshot: null });
  };
  const confirmRaw = async () => {
    if (navigationLock.current) return;
    navigationLock.current = true; setNavigating(true);
    try {
      await enterRaw(rawPending, rawPending?.source || "", rawPending?.generationInput || input, rawPending?.templateId || "T01", !rawPending?.isRegeneration);
      if (rawPending?.beforeArticle) saveArticleSnapshot(rawPending.beforeArticle);
      if (rawPending?.ignoredImages) setToast(`${rawPending.ignoredImages} 张 Markdown 图片未导入，请在编辑器中插入原图`);
    } catch { storageFailure(); }
    finally { navigationLock.current = false; setNavigating(false); }
  };
  if (!ready) return <main className="create-shell workspace-loading" role="status">{startupError ? <>本地草稿读取失败<button className="text-link" onClick={() => window.location.reload()}>重新加载</button></> : "正在读取本地草稿…"}</main>;
  if (page === "create")
    return (
      <Create
        input={input}
        setInput={setInput}
        modal={modal}
        setModal={setModal}
        loading={loading || navigating}
        aiConfigured={aiConfigured}
        aiPreferences={aiPreferences}
        platformStatus={platformStatus}
        updateAIPreferences={updateAIPreferences}
        drafts={drafts}
        openDraft={openDraft}
        removeDraft={removeDraft}
        openHistory={openHistory}
        confirmRaw={confirmRaw}
        cancelGeneration={cancelGeneration}
        generate={generate}
        addFiles={addFiles}
        uploads={uploads}
        dismissUpload={id => setUploads(current => current.filter(item => item.id !== id))}
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
      return { ignoredImages: parsed.ignoredImages };
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
        ...aiRequest,
      }),
      signal: AbortSignal.timeout(GENERATION_TIMEOUT_MS + 10000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message || "重新生成失败");
    if (latestArticle.current !== article) throw new Error("生成期间正文或设置已修改，本次结果未覆盖，请重新生成");
    setArticle({ ...result.article, id: article.id, createdAt: article.createdAt, settings: { ...result.article.settings, accountName: article.settings?.accountName } });
    setSelected(result.article.templateId);
    return result;
  };
  return (
    <Edit
      key={editorSession}
      onHistorySaved={() => saveArticleHistory(article, assets)}
      onHistoryOpened={openHistory}
      savedSnapshot={savedSnapshot}
      onSnapshotSaved={saveArticleSnapshot}
      onSnapshotCleared={() => {
        setSavedSnapshot(null);
      }}
      copyFailure={copyFailure}
      onReturnToCreate={returnToCreate}
      navigating={navigating}
      onRegenerate={regenerate}
      rawPending={rawPending}
      confirmRaw={confirmRaw}
      article={article}
      setArticle={setArticle}
      template={template}
      selected={selected}
      setSelected={setSelected}
      recs={recs}
      assets={assets}
      setAssets={setAssets}
      canvasWidth={canvasWidth}
      setCanvasWidth={setCanvasWidth}
      copy={copy}
      clear={clear}
      saved={saved}
      setModal={setModal}
      modal={modal}
      setToast={setToast}
      toast={toast}
      aiConfigured={aiConfigured}
      aiPreferences={aiPreferences}
      aiRequest={aiRequest}
      platformStatus={platformStatus}
      updateAIPreferences={updateAIPreferences}
    />
  );
}
function Toast({ message, onClose }) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const timer = setTimeout(() => close.current(), 5000);
    return () => clearTimeout(timer);
  }, [message]);
  return <div className="toast" role="status"><span>{message}</span><button aria-label="关闭提示" onClick={onClose}><X size={15}/></button></div>;
}

function Create({
  drafts,
  openDraft,
  removeDraft,
  openHistory,
  confirmRaw,
  input,
  setInput,
  modal,
  setModal,
  loading,
  aiConfigured,
  aiPreferences,
  platformStatus,
  updateAIPreferences,
  cancelGeneration,
  generate,
  addFiles,
  fileRef,
  uploads,
  dismissUpload,
  assets,
  removeImage,
  reuploadAsset,
  moveImage,
  toast,
  setToast,
}) {
  const [dragging, setDragging] = useState(false);
  const [previewFile, setPreviewFile] = useState(null);
  const [previewImage, setPreviewImage] = useState(null);
  const isUploading = uploads.some(item => item.status !== 'error');
  const [serviceOpen, setServiceOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
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
        <div className="wordmark"><span className="mark">W</span><strong>Weave</strong><span className="brand-divider"/><small>内容工作台</small></div>
        <div className="brand-actions">
          <button className="ghost-action article-history-action" onClick={() => setHistoryOpen(true)} title="历史记录" aria-label="历史记录"><History size={16}/><span>历史记录</span></button>
          <AISettingsButton configured={aiConfigured} onClick={() => setServiceOpen(true)} />
        </div>
      </header>
      <section className="hero">
        <div><p className="eyebrow">WORKSPACE</p><h1>新建文章<span>.</span></h1></div>
        <div className="hero-index" aria-label="创作流程"><span className="hero-step active">01 素材</span><ArrowRight size={13}/><span className="hero-step">02 编辑</span><ArrowRight size={13}/><span className="hero-step">03 导出</span></div>
      </section>
      <section className="create-grid">
        <div className="input-column">
          <div className="section-caption"><span>文章素材</span><span>自动保存</span></div>
          <div className="field-block">
            <label htmlFor="article-topic">主题<small>{input.mode === 'create' ? '或直接添加素材' : '选填'}</small></label>
            <input id="article-topic" maxLength={64} value={input.topic} disabled={loading} onChange={event => setInput({ ...input, topic: event.target.value })} placeholder="想写点什么？"/>
            {input.topic.trim() && <div className="field-meta"><span>{input.topic.trim().length}/64</span></div>}
          </div>
          <div className="field-block material-field">
            <label htmlFor="article-material">{input.mode === 'raw' || input.mode === 'polish' ? '原文' : '素材'}</label>
            <div className="material-editor"><textarea id="article-material" value={input.text} disabled={loading} onChange={event => setInput({ ...input, text: event.target.value })} placeholder="粘贴文字、笔记，或在下方添加文件…"/><div className="material-footer"><span className={textCount > 30000 ? 'error' : ''}>{textCount.toLocaleString()} / 30,000 字</span>{input.text && <button className="text-link" disabled={loading} onClick={() => setInput({ ...input, text: '' })}>清空</button>}</div></div>
            {inputError && (input.text || input.topic || input.files.length > 0) && <div className="field-validation">{inputError}</div>}
          </div>
          <div className={`upload-row${dragging ? ' is-dragging' : ''}`} onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false); }} onDrop={event => { event.preventDefault(); setDragging(false); if (!loading) addFiles(event.dataTransfer.files); }}>
            <button className="upload-zone" disabled={isUploading || loading} onClick={() => { fileRef.current.accept = '.docx,.pdf,.txt,.md'; fileRef.current.click(); }}><span className="upload-icon"><Upload size={18}/></span><span>添加文档<small>DOCX / PDF / TXT / MD · 20 MB</small></span><Plus size={15}/></button>
            <button className="upload-zone" disabled={isUploading || loading} onClick={() => { fileRef.current.accept = 'image/jpeg,image/png,image/webp'; fileRef.current.click(); }}><span className="upload-icon"><ImagePlus size={18}/></span><span>添加图片<small>JPG / PNG / WEBP · 10 MB</small></span><Plus size={15}/></button>
            <input ref={fileRef} hidden type="file" multiple onChange={event => { addFiles(event.target.files); event.target.value = ''; }}/>
          </div>
          {uploads.length > 0 && <div className="upload-queue" aria-live="polite">{uploads.map(item => <div className={`upload-task${item.status === 'error' ? ' is-error' : ''}`} key={item.id}>
            {item.status === 'error' ? <FileText size={17}/> : <RefreshCw className="spin" size={17}/>}<div><strong>{item.file.name}</strong><small>{item.status === 'error' ? item.error : item.status === 'pending' ? '等待上传' : /\.(docx|pdf|txt|md)$/i.test(item.file.name) ? '正在解析…' : '正在上传…'}</small></div>
            {item.status === 'error' && <><button className="text-link" disabled={isUploading || loading} onClick={() => { dismissUpload(item.id); addFiles([item.file]); }}>重试</button><button className="asset-remove" aria-label="移除上传记录" onClick={() => dismissUpload(item.id)}><X size={14}/></button></>}
          </div>)}</div>}
          {(input.files.length > 0 || input.images.length > 0) && <section className="material-assets">
            <div className="section-caption"><span>已添加 <b>{input.files.length + input.images.length}</b></span><small>{input.files.length > 0 ? `${input.files.length} 个文档` : ''}{input.files.length > 0 && input.images.length > 0 ? ' · ' : ''}{input.images.length > 0 ? `${input.images.length} 张图片` : ''}</small></div>
            {input.files.length > 0 && <div className="asset-list">{input.files.map((file, index) => <div className={`document-asset${file.ok ? '' : ' is-error'}`} key={`${file.name}:${index}`}>
              <div className="asset-line"><span className="file-icon"><FileText size={18}/></span><div className="asset-file-info"><strong title={file.name}>{file.name}</strong><small>{file.ok ? `${(file.text?.length || 0).toLocaleString()} 字 · 已解析` : file.error || '解析失败'}</small></div>{file.ok && file.preview && <button className="asset-control" aria-label={previewFile === index ? '收起文档' : '预览文档'} aria-expanded={previewFile === index} onClick={() => setPreviewFile(previewFile === index ? null : index)}>{previewFile === index ? <ChevronUp size={15}/> : <ChevronDown size={15}/>}</button>}<button className="asset-remove" aria-label={`移除文档：${file.name}`} disabled={loading} onClick={() => { setInput(value => ({ ...value, files: value.files.filter((_, i) => i !== index) })); setPreviewFile(null); }}><X size={15}/></button></div>
              {previewFile === index && <p className="asset-preview-text">{file.preview}</p>}{file.warnings?.length > 0 && <p className="asset-warning">{file.warnings.join('；')}</p>}
            </div>)}</div>}
            {input.images.length > 0 && <div className="image-asset-grid">{input.images.map((file, index) => { const asset = assets.get(file.id); return <div className="image-asset-card" key={file.id || index}>
              <button className="image-asset-preview" onClick={() => setPreviewImage(file.id)} aria-label={`预览图片：${file.name}`}><img src={asset?.previewUrl || asset?.cacheUrl || asset?.url} alt={file.name}/><span className="image-order">{String(index + 1).padStart(2, '0')}</span>{asset?.pasteStatus === 'broken' && <span className="image-broken">需重新上传</span>}</button>
              <div className="image-asset-caption"><strong title={file.name}>{file.name}</strong><small>{asset?.width && asset?.height ? `${asset.width} × ${asset.height}` : '图片素材'}</small></div><div className="asset-controls"><button aria-label="前移图片" disabled={index === 0 || loading} onClick={() => moveImage(index, -1)}><ArrowLeft size={14}/></button><button aria-label="后移图片" disabled={index === input.images.length - 1 || loading} onClick={() => moveImage(index, 1)}><ArrowRight size={14}/></button>{asset?.pasteStatus === 'broken' && <button className="text-link" disabled={loading} onClick={() => reuploadAsset(file.id)}>重传</button>}<button className="asset-remove" aria-label={`移除图片：${file.name}`} disabled={loading} onClick={() => removeImage(file.id)}><X size={14}/></button></div>
            </div>; })}</div>}
          </section>}
        </div>
        <aside className="settings-column">
          <div className="section-caption"><span>创作设置</span><Settings2 size={14}/></div>
          <div className="setting-section"><label>方式</label><div className="mode-list">{Object.entries(CREATION_MODES).map(([id, { label, hint }]) => <button className={input.mode === id ? 'mode-option active' : 'mode-option'} key={id} disabled={loading} aria-pressed={input.mode === id} onClick={() => setInput({ ...input, mode: id })}><span><strong>{label}</strong><small>{hint}</small></span><span className="radio-dot">{input.mode === id && <Check size={11}/>}</span></button>)}</div></div>
          {input.mode !== 'raw' && <><div className="setting-section"><label>语气</label><div className="segmented">{Object.entries(WRITING_TONES).map(([id, { label, hint }]) => <button className={input.tone === id ? 'selected' : ''} key={id} title={hint} aria-pressed={input.tone === id} disabled={loading} onClick={() => setInput({ ...input, tone: id })}>{label}</button>)}</div></div><div className="setting-section"><label>字数<small>约 ±15%</small></label><div className="segmented">{TARGET_LENGTHS.map(length => <button className={input.targetLength === length ? 'selected' : ''} key={length} aria-pressed={input.targetLength === length} disabled={loading} onClick={() => setInput({ ...input, targetLength: length })}>{length}</button>)}</div></div></>}
          {input.mode !== 'raw' && aiConfigured === false && <div className="ai-config-error" role="status"><span>{aiPreferences.provider === 'personal' ? '请先完成个人 AI 配置' : platformStatus?.configurationError?.message || '平台 AI 尚未配置'}</span><button onClick={() => setServiceOpen(true)}>设置</button></div>}
          <div className="create-submit"><button className="primary-action" disabled={!valid || textCount > 30000 || loading || isUploading || (input.mode !== 'raw' && !aiConfigured)} onClick={generate}>{loading ? <><RefreshCw size={16} className="spin"/>生成中…</> : <>{input.mode === 'raw' ? <FileText size={16}/> : <Sparkles size={16}/>} {input.mode === 'raw' ? '开始排版' : input.mode === 'polish' ? '润色文章' : '生成文章'}<ArrowRight size={16}/></>}</button>{loading ? <div className="generation-feedback" role="status"><span className="activity-line"/><span>正在撰写与检查内容</span><button className="text-link" onClick={cancelGeneration}>取消</button></div> : <p className="submit-note">{isUploading ? '等待素材上传完成' : input.mode === 'raw' ? '保留原文，直接进入编辑' : aiConfigured ? '生成后可继续编辑与排版' : '选择可用的 AI 服务后开始创作'}</p>}</div>
        </aside>
      </section>
      {toast && <Toast message={toast} onClose={() => setToast('')}/>}
      {historyOpen && <ArticleHistory
        drafts={drafts}
        onClose={() => setHistoryOpen(false)}
        onOpenDraft={async id => {
          const hasMaterials = input.topic.trim() || input.text.trim() || input.files.length || input.images.length;
          if (hasMaterials && !window.confirm('继续编辑草稿将清空当前尚未生成的新文章素材，是否继续？')) return false;
          const opened = await openDraft(id);
          if (opened) setHistoryOpen(false);
          return opened;
        }}
        onDeleteDraft={removeDraft}
        onOpen={async record => { await openHistory(record); setHistoryOpen(false); }}
        setToast={setToast}
      />}
      {modal === "raw-mismatch" && <div className="modal-backdrop"><section className="small-modal" role="dialog" aria-modal="true" aria-labelledby="raw-mismatch-title"><h2 id="raw-mismatch-title">原文解析需要确认</h2><p>解析后的正文与原文存在差异，请进入编辑后核对内容。</p><div className="modal-buttons"><button className="ghost-action" onClick={() => setModal(null)}>返回修改</button><button className="publish-action" onClick={confirmRaw}>仍然继续</button></div></section></div>}
      {previewImage && assets.get(previewImage) && <div className="modal-backdrop" onClick={() => setPreviewImage(null)}><div className="asset-lightbox" role="dialog" aria-modal="true" aria-label="图片预览" onClick={event => event.stopPropagation()}><button className="modal-close" aria-label="关闭图片预览" onClick={() => setPreviewImage(null)}><X size={20}/></button><img src={assets.get(previewImage).previewUrl || assets.get(previewImage).cacheUrl || assets.get(previewImage).url} alt="素材预览"/></div></div>}
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
        platformStatus={platformStatus}
        preferences={aiPreferences}
        onPreferencesChange={updateAIPreferences}
      />
    </main>
  );
}
const previewDocument = html => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><style>*{box-sizing:border-box}html,body{margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}p{overflow-wrap:anywhere}img{max-width:100%;height:auto}</style></head><body>${html}</body></html>`;

function TemplateThumb({ article, template, assets, large = false }) {
  const container = useRef();
  const [scale, setScale] = useState(large ? 0.5 : 0.2);
  const html = useMemo(() => renderArticle(
    { ...article, html: undefined, layoutDesign: undefined, blocks: article.blocks.slice(0, 12) },
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
  onHistorySaved,
  onHistoryOpened,
  rawPending,
  confirmRaw,
  copyFailure,
  savedSnapshot,
  onSnapshotSaved,
  onSnapshotCleared,
  onRegenerate,
  aiConfigured,
  aiPreferences,
  aiRequest,
  platformStatus,
  updateAIPreferences,
  onReturnToCreate,
  navigating,
  article,
  setArticle,
  template,
  selected,
  setSelected,
  recs,
  assets,
  setAssets,
  canvasWidth,
  setCanvasWidth,
  copy,
  clear,
  saved,
  setModal,
  modal,
  setToast,
  toast,
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [savingHistory, setSavingHistory] = useState(false);
  const [serviceOpen, setServiceOpen] = useState(false);
  const [library, setLibrary] = useState(false);
  const [libraryView, setLibraryView] = useState("templates");
  const [libraryOriginal, setLibraryOriginal] = useState(selected);
  const [layoutTrial, setLayoutTrial] = useState(null);
  const [layoutReset, setLayoutReset] = useState(0);
  const [sideTab, setSideTab] = useState('templates');
  const [toolsOpen, setToolsOpen] = useState(true);
  const resetLayoutTrial = () => { setLayoutTrial(null); setLayoutReset(value => value + 1); };
  const applyLayoutTrial = () => {
    const candidate = layoutTrial;
    if (!candidate) return;
    if (layoutSignature(article) !== candidate.signature) {
      resetLayoutTrial();
      setToast('正文已变化，请重新设计');
      return;
    }
    setArticle(current => layoutSignature(current) === candidate.signature
      ? { ...clearArticleStyles(current), layoutDesign: candidate.design, updatedAt: new Date().toISOString() }
      : current);
    resetLayoutTrial();
    setToast('排版已应用，可撤销');
  };
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
  const aiEditor = useAIEdit({ article, setArticle, assets, aiRequest, disabled: !aiConfigured || library || regenerating || Boolean(layoutTrial), onApplied: resetLayoutTrial, onCandidate: () => { if (window.matchMedia('(max-width: 760px)').matches) setToolsOpen(false); }, setToast });
  const history = useRef([]);
  const future = useRef([]);
  const [historySize, setHistorySize] = useState(0);
  const [futureSize, setFutureSize] = useState(0);
  const lastArticle = useRef(article);
  const historyMove = useRef(false);
  const [account, setAccount] = useState(
    article.settings?.accountName || "我的公众号",
  );
  const bodyLength = TARGET_LENGTHS.includes(article.settings?.targetLength)
    ? bodyLengthStatus(article.blocks, article.settings.targetLength) : null;
  const imageInput = useRef();
  const [imageUploads, setImageUploads] = useState(0);
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
      if (historyOpen) return;
      if (
        !(e.ctrlKey || e.metaKey) ||
        e.key.toLowerCase() !== "z" ||
        ["INPUT", "TEXTAREA"].includes(e.target.tagName)
      )
        return;
      if (editorPane.current?.querySelector('[aria-readonly="true"]')) return;
      e.preventDefault();
      e.shiftKey ? redo() : undo();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [article, historyOpen]);
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
  const editorPane = useRef();
  const activeKeyRef = useRef(null);
  const [activeKey, setActiveKey] = useState(null);
  const locateContent = (key, source) => {
    activeKeyRef.current = key;
    setActiveKey(key);
    if (source === 'editor') return;
    if (window.matchMedia('(max-width: 760px)').matches) setToolsOpen(false);
    requestAnimationFrame(() => {
      const pane = editorPane.current?.querySelector('.canvas-scroll');
      const target = pane?.querySelector(`[data-editor-key="${CSS.escape(key)}"]`);
      if (target) pane.scrollTo({ top: Math.max(0, pane.scrollTop + target.getBoundingClientRect().top - pane.getBoundingClientRect().top - 40), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    });
  };
  const locateFromCanvas = event => {
    const key = event.target.closest('[data-editor-key]')?.dataset.editorKey;
    if (key) locateContent(key, 'editor');
  };
  const aiPreview = !library && !layoutTrial ? aiEditor.previewArticle : null;
  const canvasArticle = useMemo(() => aiPreview || (layoutTrial?.signature === layoutSignature(article)
    ? { ...clearArticleStyles(article), layoutDesign: layoutTrial.design } : article), [article, aiPreview, layoutTrial]);
  const canvasReadOnly = Boolean(navigating || aiPreview || layoutTrial || library || regenerating || aiEditor.busy === 'checking');
  const preview = useMemo(() => renderArticle({ ...article, html: undefined, layoutDesign: undefined }, template, assets, { mode: 'preview' }).html, [article, template, assets]);
  const chooseTemplate = (id) => {
    resetLayoutTrial();
    if (!library) {
      setLibraryOriginal(article.templateId);
      setLibraryView("templates");
      setSelected(id);
      setLibrary(true);
      return;
    }
    setSelected(id);
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
    locateContent(`block:${id}`);
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
    setImageUploads(count => count + 1);
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
      setToast(e.message || "图片上传失败");
    } finally {
      setImageUploads(count => count - 1);
    }
  };
  const requestRegenerate = async () => {
    if (regenerating || canvasReadOnly) return;
    const previous = article;
    setRegenerating(true);
    try {
      const result = await onRegenerate();
      if (!result?.pending) {
        onSnapshotSaved?.(previous);
        setToast(result?.ignoredImages ? `${result.ignoredImages} 张 Markdown 图片未导入，请在编辑器中插入原图` : "文章已重新生成");
      }
    } catch (e) {
      setToast(e.message || "重新生成失败");
    } finally {
      setRegenerating(false);
    }
  };
  const saveHistory = async () => {
    if (savingHistory || canvasReadOnly) return;
    setSavingHistory(true);
    try {
      await onHistorySaved();
      setToast("已保存到历史记录");
    } catch { setToast("历史记录保存失败，请检查浏览器存储空间"); }
    finally { setSavingHistory(false); }
  };
  return (
    <div className="edit-shell">
      <header className="edit-topbar">
        <button className="back-button" disabled={navigating || imageUploads > 0 || regenerating || savingHistory || Boolean(aiEditor.busy)} onClick={onReturnToCreate}>
          <ArrowLeft size={17} />
          <span>{navigating ? "保存中…" : "新建文章"}</span>
        </button>
        <div className="edit-brand">
          <span className="mark small">W</span>
          <strong>Weave</strong>
          <span className="draft-status" title={saved ? `保存于 ${saved}` : undefined}>
            <i></i>
            {saved ? "已保存" : "保存中"}
          </span>
        </div>
        <div className="top-actions">
          <div className="history-tools">
            <button onClick={undo} disabled={!historySize || canvasReadOnly} title="撤销 Ctrl+Z" aria-label="撤销"><Undo2 size={16}/></button>
            <button onClick={redo} disabled={!futureSize || canvasReadOnly} title="重做 Ctrl+Shift+Z" aria-label="重做"><Redo2 size={16}/></button>
          </div>
          <button className="icon-action tools-toggle" aria-label={toolsOpen ? '折叠工具面板' : '展开工具面板'} aria-controls="workspace-tools" aria-expanded={toolsOpen} title={toolsOpen ? '折叠工具面板' : '展开工具面板'} onClick={() => setToolsOpen(value => !value)}>{toolsOpen ? <PanelRightClose size={17}/> : <PanelRightOpen size={17}/>}</button>
          <AISettingsButton configured={aiConfigured} onClick={() => setServiceOpen(true)} />
          <button className="ghost-action" disabled={navigating || regenerating || imageUploads > 0 || savingHistory || Boolean(aiEditor.busy)} onClick={() => setModal("clear")}>
            清空草稿
          </button>
          <button className="ghost-action article-history-action" onClick={() => setHistoryOpen(true)} disabled={canvasReadOnly || Boolean(aiEditor.busy) || savingHistory} title="历史记录" aria-label="历史记录">
            <History size={16}/><span>历史记录</span>
          </button>
          <button className="ghost-action article-history-action" onClick={saveHistory} disabled={canvasReadOnly || savingHistory || imageUploads > 0} title="保存历史" aria-label="保存历史">
            <Save size={16}/><span>{savingHistory ? "保存中" : "保存历史"}</span>
          </button>
          <button className="publish-action" disabled={Boolean(layoutTrial || aiPreview)} title={layoutTrial || aiPreview ? '应用当前方案后再复制' : undefined} onClick={() => copy()}>
            <Copy size={16} />
            复制排版
          </button>
        </div>
      </header>
      {historyOpen && <ArticleHistory onClose={() => setHistoryOpen(false)} onOpen={async record => { await onHistoryOpened(record); setHistoryOpen(false); }} setToast={setToast}/>}
      <AIServiceSettings
        open={serviceOpen}
        onClose={() => setServiceOpen(false)}
        platformStatus={platformStatus}
        preferences={aiPreferences}
        onPreferencesChange={updateAIPreferences}
      />
      <div className={`edit-workspace${toolsOpen ? ' tools-open' : ''}`}>
        <main className="canvas-pane" ref={editorPane} onClickCapture={locateFromCanvas} onFocusCapture={locateFromCanvas}>
          <div className="canvas-toolbar">
            <div className="canvas-heading"><strong>{canvasArticle.layoutDesign?.name || template.name}</strong><span>{canvasReadOnly ? '方案预览' : '直接编辑'}</span></div>
            <div className="width-switch" role="group" aria-label="画布宽度">
              {[320, 375, 414, 720].map(width => <button key={width} aria-pressed={canvasWidth === width} className={canvasWidth === width ? 'on' : ''} onClick={() => setCanvasWidth(width)}>{width === 720 ? '宽屏' : width}</button>)}
            </div>
            <div className="writing-status" aria-label="当前文章创作设置"><span>正文 {bodyLength?.actual ?? bodyCharCount(article.blocks)} 字</span><span className={article.title.length > 64 ? 'error' : ''}>标题 {article.title.length}/64</span></div>
          </div>
          {aiEditor.candidate && !aiEditor.problem && <div className="ai-edit-preview-bar"><span>{aiPreview ? `${aiEditor.changes.length} 处改动 · 应用后可编辑` : '原稿'}</span><div><button className="text-link" disabled={Boolean(aiEditor.busy)} onClick={aiEditor.discard}>取消</button><button className="text-link" onClick={() => aiEditor.setShowCandidate(value => !value)}>{aiEditor.showCandidate ? '看原稿' : '看方案'}</button><button className="preview-apply" disabled={Boolean(aiEditor.busy || aiEditor.problem)} onClick={aiEditor.apply}><Check size={13}/>应用</button></div></div>}
          {layoutTrial && <div className="ai-edit-preview-bar layout-preview-bar"><span>{layoutTrial.design.name} · 应用后可编辑</span><div><button className="text-link" onClick={resetLayoutTrial}>取消</button><button className="preview-apply" onClick={applyLayoutTrial}><Check size={13}/>应用排版</button></div></div>}
          {imageUploads > 0 && <div className="editor-uploading" role="status"><RefreshCw size={14} className="spin"/>上传图片中…</div>}
          <ArticleEditor
            article={article} displayArticle={canvasArticle === article ? undefined : canvasArticle} readOnly={canvasReadOnly} width={canvasWidth} changes={aiPreview ? aiEditor.changes : []}
            setArticle={setArticle} template={template} assets={assets} activeKey={activeKey}
            onSelect={key => locateContent(key, 'editor')} onReference={aiEditor.addReference} onUpload={uploadImage} onRegisterAsset={registerImageAsset}
            onGallery={(index, blockId = null) => { setInsertAt(index); setReplaceBlockId(blockId); setModal('gallery'); }} setToast={setToast}
            header={<div className="canvas-account"><input maxLength={64} value={account} disabled={canvasReadOnly} onChange={event => { setAccount(event.target.value); setArticle(a => ({ ...a, settings: { ...a.settings, accountName: event.target.value } })); }} aria-label="公众号名称"/><span>{new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })}</span></div>}
            footer={<div className="canvas-footer" style={{ width: canvasWidth }}>
              <button className="add-block" disabled={canvasReadOnly} onClick={() => { setInsertAt(article.blocks.length); setModal('add'); }}><Plus size={15}/>添加内容</button>
              <div className="article-end-actions"><button className="text-link" disabled={!aiConfigured || regenerating || canvasReadOnly} onClick={requestRegenerate}><RefreshCw size={14} className={regenerating ? 'spin' : ''}/>重新生成</button>{snapshot && <button className="text-link" disabled={canvasReadOnly} onClick={() => { setArticle(snapshot); setSelected(snapshot.templateId); onSnapshotCleared?.(); }}>撤销重新生成</button>}</div>
            </div>}
          />
        </main>
        <aside id="workspace-tools" hidden={!toolsOpen} className={`template-pane${sideTab === 'ai' ? ' ai-edit-pane' : ''}`}>
          <div className="tools-heading"><span>排版与 AI</span><button className="asset-remove" aria-label="关闭工具面板" onClick={() => setToolsOpen(false)}><X size={16}/></button></div>
          <div className="side-panel-tabs" role="tablist" aria-label="右侧工具">
            <button id="templates-tab" role="tab" aria-selected={sideTab === 'templates'} aria-controls="templates-panel" onClick={() => setSideTab('templates')}>模板</button>
            <button id="ai-edit-tab" role="tab" aria-selected={sideTab === 'ai'} aria-controls="ai-edit-panel" onClick={() => setSideTab('ai')}>AI 修改{aiEditor.references.length > 0 && <span>{aiEditor.references.length}</span>}</button>
          </div>
          <div className="side-panel-content" id="templates-panel" role="tabpanel" aria-labelledby="templates-tab" hidden={sideTab !== 'templates'}>
          <React.Suspense fallback={null}><LayoutDesigner key={article.id} article={article} setArticle={setArticle} aiRequest={aiRequest} onTrial={candidate => { setLayoutTrial(candidate); if (candidate && window.matchMedia('(max-width: 760px)').matches) setToolsOpen(false); }} resetKey={layoutReset} disabled={!aiConfigured || library || regenerating || Boolean(aiEditor.busy)} setToast={setToast} /></React.Suspense>
          <div className="recommend-label">
            <span>推荐模板</span>
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

                </span>
                {selected === t.id && <span className="selected-tick">✓</span>}
              </button>
            ))}
          </div>
          <button className="all-templates" onClick={openLibrary}>
            <LayoutGrid size={16} />
            全部模板
            <ArrowRight size={15} />
          </button>
          <div className="template-current"><span>当前</span><strong>{article.layoutDesign?.name || template.name}</strong></div>
          </div>
          <div className="side-panel-content ai-edit-slot" id="ai-edit-panel" role="tabpanel" aria-labelledby="ai-edit-tab" hidden={sideTab !== 'ai'}>
            <AIEditPanel editor={aiEditor} article={article} assets={assets} disabled={!aiConfigured || library || regenerating || Boolean(layoutTrial)} onLocate={key => locateContent(key)}/>
          </div>
        </aside>
      </div>
      {library && (
        <div className="modal-backdrop library-backdrop" onClick={cancelLibrary}>
          <div className="library-modal" role="dialog" aria-modal="true" aria-labelledby="library-title" onClick={(e) => e.stopPropagation()}>
            <header>
              <div>

                <h2 id="library-title">为这篇文章选择版式</h2>
                <p className="library-intro">点击模板，预览当前文章。</p>
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
              <button className={libraryView === "templates" ? "selected" : ""} aria-pressed={libraryView === "templates"} onClick={() => setLibraryView("templates")}>模板 · {filtered.length}</button>
              <button className={libraryView === "preview" ? "selected" : ""} aria-pressed={libraryView === "preview"} onClick={() => setLibraryView("preview")}>文章预览</button>
            </div>
            <div className={`library-workspace view-${libraryView}`}>
              <div className="library-catalog">
                <div className="library-result-count">{filtered.length} 套模板</div>
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
                    <p className="empty-result">暂无匹配模板</p>
                  )}
                </div>
              </div>
              <aside className="library-inspector">
                <div className="library-preview-heading" aria-live="polite">
                  <span className="eyebrow">预览</span>
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
                    html: undefined,
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
                      const payload = { article };
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
            ) : modal === "gallery" ? (
              <>

                <h2>{replaceBlockId ? "替换图片" : "插入图片"}</h2>
                <div className="image-source-tabs" role="tablist" aria-label="图片来源">
                  <button role="tab" aria-selected={imageSource === 'local'} onClick={() => setImageSource('local')}>素材库</button>
                  <button role="tab" aria-selected={imageSource === 'link'} onClick={() => setImageSource('link')}>图片链接</button>
                </div>
                {imageSource === 'link' ? <ImageLinkInput replacing={Boolean(replaceBlockId)} onInsert={async asset => {
                  await registerImageAsset(asset);
                  return placeImageAsset(asset, insertAt, replaceBlockId);
                }} onDone={id => {
                  setModal(null);
                  locateContent(`block:${id}`);
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
                        locateContent(`block:${id}`);
                      }}
                    >
                      <img src={asset.previewUrl || asset.url} alt="" />
                      <span>{asset.filename || asset.id}</span>
                    </button>
                  ))}
                  {assets.size === 0 && <div className="gallery-empty"><ImagePlus size={28}/><p>添加第一张图片</p><small>支持拖入编辑器或上传文件</small></div>}
                </div>
                <button
                  className="text-link"
                  onClick={() => imageInput.current?.click()}
                >
                  <ImagePlus size={15} />
                  上传图片
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
                      locateContent(`block:${id}`);
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
                  <button className="danger-action" disabled={navigating} onClick={clear}>
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
        <Toast message={toast} onClose={() => setToast('')}/>
      )}
    </div>
  );
}

function App() {
  return window.location.pathname.replace(/\/+$/, '') === '/baolongadmin' ? <AdminPage /> : <WorkspaceApp />;
}

createRoot(document.getElementById("root")).render(<App />);
