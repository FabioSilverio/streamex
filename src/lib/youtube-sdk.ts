export interface YTPlayer {
  getCurrentTime: () => number;
  getDuration: () => number;
  getPlayerState: () => number;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  getVolume?: () => number;
  setVolume?: (volume: number) => void;
  isMuted?: () => boolean;
  mute?: () => void;
  unMute?: () => void;
  getPlaybackRate?: () => number;
  setPlaybackRate?: (suggestedRate: number) => void;
  getAvailablePlaybackRates?: () => number[];
  destroy: () => void;
}

/** YT.PlayerState values we care about. */
export const YT_STATE = { ENDED: 0, PLAYING: 1, PAUSED: 2 } as const;

declare global {
  interface Window {
    YT?: {
      Player: new (
        el: HTMLElement,
        opts: {
          videoId: string;
          width?: string | number;
          height?: string | number;
          playerVars?: Record<string, string | number>;
          events?: {
            onReady?: () => void;
            onStateChange?: (e: { data: number }) => void;
            onPlaybackRateChange?: (e: { data: number }) => void;
            onError?: () => void;
          };
        },
      ) => YTPlayer;
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

const SRC = "https://www.youtube.com/iframe_api";
let loading: Promise<void> | null = null;

/** Load YouTube's IFrame Player API once. */
export function loadYouTubeSdk(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve();
    };
    const script = document.createElement("script");
    script.src = SRC;
    script.async = true;
    script.onerror = () => {
      loading = null;
      reject(new Error("youtube sdk"));
    };
    document.body.appendChild(script);
  });
  return loading;
}
