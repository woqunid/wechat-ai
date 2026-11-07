import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

export function Toast({ message, onClose }) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const timer = setTimeout(() => close.current(), 5000);
    return () => clearTimeout(timer);
  }, [message]);
  return <div className="toast" role="status"><span>{message}</span><button aria-label="关闭提示" onClick={onClose}><X size={15}/></button></div>;
}
