import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { getTemplate } from "./templates";
import { renderArticle } from "./renderer";
import { copyHtml } from "./clipboard";
import { checkRawConsistency, parseRaw } from "./rawparser";
import { uid } from "./core";
import { GENERATION_TIMEOUT_MS } from "./creation.js";
import { recommendTemplates } from "./recommender";
import { AIServiceSettings } from "./AIServiceSettings";
import { aiRequestOptions, loadAIPreferences, saveAIPreferences, selectedAIIsReady } from "./ai-preferences.js";
import { reconcileHtmlArticle } from "./document-model.js";
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
import { AdminPage } from "./AdminPage";
import { absoluteUrl, assetAvailable, downloadJson, postJson, requestJson, uploadAsset } from "./api.js";
import { ConfirmDialog } from "./Modal.jsx";
import { Toast } from "./Toast";
import { CreatePage } from "./CreatePage";
import { EditPage } from "./EditPage";
import "./styles.css";

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
  const [serviceOpen, setServiceOpen] = useState(false);
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
    requestJson("/api/config/status", { fallback: "AI 服务状态读取失败" })
      .then(data => { if (active) setPlatformStatus(data); })
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
          assetAvailable(asset.cacheUrl || asset.url)
            .then(ok => {
              if (!ok) setAssets(current => current.get(asset.id) === asset ? new Map(current).set(asset.id, { ...asset, pasteStatus: "broken" }) : current);
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
      const data = await postJson("/api/articles/generate", {
          mode,
          topic: submittedInput.topic,
          text: submittedInput.text,
          materials: submittedInput.files.filter((f) => f.ok).map((f) => f.text).filter(Boolean),
          tone: submittedInput.tone,
          targetLength: submittedInput.targetLength,
          assetIds: submittedInput.images.map((image) => image.id).filter(Boolean),
          ...aiRequest,
        }, {
        signal: AbortSignal.any([
          requestAbort.current.signal,
          AbortSignal.timeout(GENERATION_TIMEOUT_MS + 10000),
        ]),
        fallback: "生成失败",
      });
      try {
        await enterEditor({ article: data.article, generationInput: submittedInput, snapshot: null });
        if (data.meta?.visionSkipped) setToast("当前模型不支持识图，图片按上传顺序排入文中");
      }
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
    try {
      const uploaded = await uploadAsset(previous.blob, { filename: previous.filename || "image.png", fallback: "图片重新上传失败" });
      const next = {
        ...uploaded,
        ...(previous.sourceUrl ? { sourceUrl: previous.sourceUrl } : {}),
        url: /^https:\/\//i.test(uploaded.url) ? uploaded.url : previous.sourceUrl || absoluteUrl(uploaded.url),
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
        try {
          const uploaded = await uploadAsset(file, { fallback: "上传失败" });
          const asset = { ...uploaded, url: absoluteUrl(uploaded.url), previewUrl: URL.createObjectURL(file), blob: file };
          setAssets((m) => new Map(m).set(asset.id, asset));
          await saveAsset(asset, file);
          setInput((v) => ({ ...v, images: [...v.images, { id: asset.id, name: file.name }] }));
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
          const d = await requestJson("/api/materials/parse", { method: "POST", body: fd, fallback: "文档解析失败" });
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
      try { broken = !(await assetAvailable(asset.cacheUrl || asset.url)); } catch {}
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
    const result = await postJson("/api/articles/generate", {
        mode: article.mode,
        topic: sourceInput.topic,
        text: sourceInput.text,
        materials: sourceInput.files.filter((f) => f.ok).map((f) => f.text).filter(Boolean),
        tone: article.settings?.tone || sourceInput.tone || "plain",
        targetLength: article.settings?.targetLength || sourceInput.targetLength || 1000,
        assetIds: [...new Set(article.blocks.filter((block) => block.type === "image" || block.type === "imageCard").map((block) => block.assetId))],
        templateId: selected,
        ...aiRequest,
      }, { signal: AbortSignal.timeout(GENERATION_TIMEOUT_MS + 10000), fallback: "重新生成失败" });
    if (latestArticle.current !== article) throw new Error("生成期间正文或设置已修改，本次结果未覆盖，请重新生成");
    setArticle({ ...result.article, id: article.id, createdAt: article.createdAt, settings: { ...result.article.settings, accountName: article.settings?.accountName } });
    setSelected(result.article.templateId);
    return result;
  };
  if (!ready) return <main className="create-shell workspace-loading" role="status">{startupError ? <>本地草稿读取失败<button className="text-link" onClick={() => window.location.reload()}>重新加载</button></> : "正在读取本地草稿…"}</main>;
  const closeModal = () => setModal(null);
  const openService = () => setServiceOpen(true);
  return (
    <>
      {page === "create" ? (
        <CreatePage
          input={input}
          setInput={setInput}
          loading={loading || navigating}
          aiConfigured={aiConfigured}
          aiPreferences={aiPreferences}
          platformStatus={platformStatus}
          openService={openService}
          drafts={drafts}
          openDraft={openDraft}
          removeDraft={removeDraft}
          openHistory={openHistory}
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
          setToast={setToast}
        />
      ) : (
        <EditPage
          key={editorSession}
          onHistorySaved={() => saveArticleHistory(article, assets)}
          onHistoryOpened={openHistory}
          savedSnapshot={savedSnapshot}
          onSnapshotSaved={saveArticleSnapshot}
          onSnapshotCleared={() => setSavedSnapshot(null)}
          copyFailure={copyFailure}
          onReturnToCreate={returnToCreate}
          navigating={navigating}
          onRegenerate={regenerate}
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
          aiConfigured={aiConfigured}
          aiRequest={aiRequest}
          openService={openService}
        />
      )}
      {modal === "raw-mismatch" && <ConfirmDialog eyebrow="原文校对" title="原文解析需要确认" onClose={closeModal} cancelLabel="返回修改" confirmLabel="仍然继续" confirmDisabled={navigating} onConfirm={confirmRaw}>
        <p>
          解析后的正文与原文存在差异，请进入编辑后核对内容。
          <br />
          源文：{rawPending?.difference?.source || "无"}
          <br />
          识别后：{rawPending?.difference?.parsed || "无"}
        </p>
      </ConfirmDialog>}
      {modal === "storage-error" && <ConfirmDialog eyebrow="本地保存" title="浏览器空间不足" onClose={closeModal} cancelLabel="继续编辑" confirmLabel="导出草稿" onConfirm={() => {
        downloadJson(page === "edit" && article ? { article } : { input }, "wechat-draft.json");
        setModal(null);
      }}>
        <p>当前内容仍在本页，可导出一份 JSON 草稿后清理浏览器空间。</p>
      </ConfirmDialog>}
      <AIServiceSettings
        open={serviceOpen}
        onClose={() => setServiceOpen(false)}
        platformStatus={platformStatus}
        preferences={aiPreferences}
        onPreferencesChange={updateAIPreferences}
      />
      {toast && <Toast message={toast} onClose={() => setToast("")} />}
    </>
  );
}

function App() {
  return window.location.pathname.replace(/\/+$/, '') === '/baolongadmin' ? <AdminPage /> : <WorkspaceApp />;
}

createRoot(document.getElementById("root")).render(<App />);