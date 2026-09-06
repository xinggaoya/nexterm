import type { Terminal } from "@xterm/xterm";
import { notifyInfo } from "@/modules/notifications/notificationCenter";
import { sendOsNotification } from "@/lib/osNotifications";

/** 两次响铃通知之间的最小间隔：BEL 风暴（如 `tput bel` 循环）不能刷屏。 */
const BELL_NOTIFY_COOLDOWN_MS = 3000;

/** Web Audio 短蜂鸣：懒创建 AudioContext，首次用户手势后才可能出声。 */
let audioContext: AudioContext | null = null;

function playBellBeep(): void {
  try {
    audioContext ??= new AudioContext();
    if (audioContext.state === "suspended") {
      void audioContext.resume();
    }
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    // 880Hz、80ms、指数衰减 —— 接近经典终端蜂Bell的听感又不刺耳。
    oscillator.type = "square";
    oscillator.frequency.value = 880;
    const now = audioContext.currentTime;
    gain.gain.setValueAtTime(0.04, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.09);
  } catch {
    // AudioContext 创建/播放失败（无手势、设备不支持）时静默。
  }
}

export type TerminalBellOptions = {
  /** 响铃通知总开关（对应 terminalNotificationEnabled 偏好）。 */
  enabled: () => boolean;
  /** 响铃声音开关（对应 terminalNotificationSoundEnabled 偏好）。 */
  soundEnabled: () => boolean;
  /** 通知标题（一般为终端标题）。 */
  title: () => string;
};

/**
 * 订阅 xterm 的 BEL 事件并按偏好分发：应用内 toast +（窗口失焦时）系统
 * 通知 + 可选蜂鸣。返回解绑函数。
 */
export function attachTerminalBell(
  term: Terminal,
  options: TerminalBellOptions,
): () => void {
  // 测试用的假 term / 非标准实现可能没有 onBell。
  if (typeof term.onBell !== "function") return () => {};
  let lastNotifiedAt = 0;
  const disposable = term.onBell(() => {
    if (!options.enabled()) return;
    if (options.soundEnabled()) playBellBeep();

    const now = Date.now();
    if (now - lastNotifiedAt < BELL_NOTIFY_COOLDOWN_MS) return;
    lastNotifiedAt = now;

    const title = options.title();
    if (document.hasFocus()) {
      notifyInfo(title, null);
    } else {
      void sendOsNotification(title);
    }
  });
  return () => disposable.dispose();
}
