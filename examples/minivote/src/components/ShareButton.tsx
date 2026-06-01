import { showToast } from "./Toast";
import Button from "./Button";

interface ShareButtonProps {
  pollId: string;
}

export default function ShareButton({ pollId }: ShareButtonProps) {
  const handleShare = async () => {
    const url = `${window.location.origin}/share/${pollId}`;
    try {
      await navigator.clipboard.writeText(url);
      showToast("链接已复制到剪贴板", "success");
    } catch {
      // Fallback for older browsers
      const input = document.createElement("input");
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
      showToast("链接已复制到剪贴板", "success");
    }
  };

  return (
    <Button variant="secondary" size="md" onClick={handleShare}>
      📋 分享
    </Button>
  );
}
