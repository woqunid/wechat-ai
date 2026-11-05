function copyWithSelection({ html, text }) {
  const selection = window.getSelection();
  const ranges = selection
    ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange())
    : [];
  const focused = document.activeElement;
  const container = document.createElement('div');
  container.contentEditable = 'true';
  container.style.cssText = 'position:fixed;left:-10000px;top:0;width:375px;user-select:text;';
  container.innerHTML = html;
  let copied = false;
  const onCopy = event => {
    if (!event.clipboardData) return;
    event.clipboardData.setData('text/html', html);
    event.clipboardData.setData('text/plain', text);
    event.preventDefault();
    copied = true;
  };
  document.body.appendChild(container);
  document.addEventListener('copy', onCopy, true);
  try {
    container.focus({ preventScroll: true });
    const range = document.createRange();
    range.selectNodeContents(container);
    selection.removeAllRanges();
    selection.addRange(range);
    if (!document.execCommand('copy') || !copied) throw new Error('HTML copy failed');
  } finally {
    document.removeEventListener('copy', onCopy, true);
    container.remove();
    focused?.focus({ preventScroll: true });
    selection?.removeAllRanges();
    for (const range of ranges) selection.addRange(range);
  }
}

export async function copyHtml(rendered) {
  let clipboardError;
  if (window.isSecureContext && navigator.clipboard?.write && window.ClipboardItem) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([rendered.html], { type: 'text/html' }),
          'text/plain': new Blob([rendered.text], { type: 'text/plain' }),
        }),
      ]);
      return;
    } catch (error) {
      clipboardError = error;
    }
  }
  try {
    copyWithSelection(rendered);
  } catch (error) {
    throw clipboardError || error;
  }
}
