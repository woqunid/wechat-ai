import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { readImageLink } from './image-assets.js';

export function ImageLinkInput({ onInsert, onDone, replacing }) {
  const [value, setValue] = useState('');
  const [asset, setAsset] = useState(null);
  const [busy, setBusy] = useState(false);
  const [inserting, setInserting] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(null);
  const preview = useRef(null);
  useEffect(() => () => {
    request.current?.abort();
    if (preview.current) URL.revokeObjectURL(preview.current.previewUrl);
  }, []);
  const clearPreview = () => {
    request.current?.abort();
    if (preview.current) URL.revokeObjectURL(preview.current.previewUrl);
    preview.current = null;
    setAsset(null);
    setBusy(false);
    setError('');
  };
  const read = async event => {
    event.preventDefault();
    clearPreview();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    try {
      const next = await readImageLink(value, controller.signal);
      if (controller.signal.aborted) { URL.revokeObjectURL(next.previewUrl); return; }
      preview.current = next;
      setAsset(next);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause.name === 'TimeoutError' ? '图片读取超时，请重试' : cause.message);
    } finally { if (!controller.signal.aborted) setBusy(false); }
  };
  const insert = async () => {
    setInserting(true);
    setError('');
    try {
      const id = await onInsert(asset);
      if (!id) throw new Error('图片未能插入，请重试');
      onDone(id);
    } catch (cause) { setError(cause.message || '图片未能插入'); }
    finally { setInserting(false); }
  };
  return <div className="image-link-input">
    <form onSubmit={read}>
      <label htmlFor="image-link">图片链接</label>
      <input id="image-link" type="url" autoFocus value={value} disabled={inserting} onChange={event => { clearPreview(); setValue(event.target.value); }} placeholder="https://图床地址/图片.jpg" spellCheck={false}/>
      <p>支持 JPG、PNG、WebP 直链，单张不超过 10MB。读取后插入图片。</p>
      <button className="ghost-action" type="submit" disabled={busy || inserting || !value.trim()}>{busy && <RefreshCw size={14} className="spin"/>}{busy ? '读取中…' : '读取图片'}</button>
    </form>
    {error && <p className="error" role="alert">{error}</p>}
    {asset && <div className="image-link-preview"><img src={asset.previewUrl} alt="即将插入的图片"/><small>{asset.width} × {asset.height} · {(asset.bytes / 1024 / 1024).toFixed(2)} MB</small><button className="publish-action" disabled={inserting} onClick={insert}>{inserting ? '保存中…' : replacing ? '替换图片' : '插入图片'}</button></div>}
  </div>;
}
