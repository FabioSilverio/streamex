export interface TwitchPlayerInstance {
  getCurrentTime: () => number;
  getDuration: () => number;
  seek: (timestamp: number) => void;
  pause: () => void;
  play: () => void;
  isPaused: () => boolean;
  getVolume?: () => number;
  setVolume?: (volume: number) => void;
  getMuted?: () => boolean;
  setMuted?: (muted: boolean) => void;
  addEventListener: (event: string, cb: () => void) => void;
}

declare global {
  interface Window {
    Twitch?: {
      Player: {
        new (element: string | HTMLElement, options: Record<string, unknown>): TwitchPlayerInstance;
        READY: string;
        PLAY: string;
        PLAYING: string;
        PAUSE: string;
        ENDED: string;
      };
    };
  }
}

const TWITCH_SDK = "https://player.twitch.tv/js/embed/v1.js";

/** Load Twitch's embed SDK once; resolves immediately if it's already on the page. */
export function loadTwitchSdk(): Promise<void> {
  if (window.Twitch?.Player) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let script = document.querySelector<HTMLScriptElement>(`script[src="${TWITCH_SDK}"]`);
    if (!script) {
      script = document.createElement("script");
      script.src = TWITCH_SDK;
      script.async = true;
      document.body.appendChild(script);
    }
    if (window.Twitch?.Player) return resolve();
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => reject(new Error("twitch sdk")), { once: true });
  });
}
