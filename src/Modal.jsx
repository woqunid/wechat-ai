import { X } from 'lucide-react';

export function Modal({ as: Tag = 'section', onClose, closeLabel = '关闭', className = '', backdropClassName = '', children, ...props }) {
  return <div className={`modal-backdrop ${backdropClassName}`.trim()} onClick={onClose}>
    <Tag className={`small-modal ${className}`.trim()} role="dialog" aria-modal="true" onClick={event => event.stopPropagation()} {...props}>
      {onClose && <button className="modal-close" type="button" aria-label={closeLabel} onClick={onClose}><X size={18}/></button>}
      {children}
    </Tag>
  </div>;
}

export function ConfirmDialog({ eyebrow, eyebrowClassName = '', title, children, onClose, cancelLabel = '取消', confirmLabel, confirmClassName = 'publish-action', confirmDisabled, onConfirm }) {
  return <Modal onClose={onClose}>
    {eyebrow && <span className={`eyebrow ${eyebrowClassName}`.trim()}>{eyebrow}</span>}
    <h2>{title}</h2>
    {children}
    <div className="modal-buttons">
      <button className="ghost-action" onClick={onClose}>{cancelLabel}</button>
      {onConfirm && <button className={confirmClassName} disabled={confirmDisabled} onClick={onConfirm}>{confirmLabel}</button>}
    </div>
  </Modal>;
}
