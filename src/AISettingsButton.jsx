import { Settings2 } from "lucide-react";

export function AISettingsButton({ configured, onClick }) {
  return (
    <button
      className="privacy-settings-link"
      type="button"
      title="AI 服务设置"
      aria-label="AI 设置"
      onClick={onClick}
    >
      <span className={`connection-dot${configured ? " connected" : ""}`} />
      <Settings2 size={15} />
      <span>AI 设置</span>
    </button>
  );
}
