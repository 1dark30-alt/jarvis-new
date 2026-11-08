// Renderer bridge exposed by dist-electron/preload.js. IPC payloads are runtime-defined.
export {};
declare global {
  interface Window {
    electron?: {
      isElectron: boolean;
      platform: string;
      onMenuAction: (...args: any[]) => any;
      setDesktopMode: (...args: any[]) => any;
      moveDesktopPanel: (...args: any[]) => any;
      setDesktopPanelMuted: (...args: any[]) => any;
      setDesktopPanelMousePassthrough: (...args: any[]) => any;
      overlayClick: (...args: any[]) => any;
      getAudioSourceId: (...args: any[]) => any;
      onDesktopOverlayClick: (...args: any[]) => any;
      onDesktopPanelMuted: (...args: any[]) => any;
      onHeyJarvis: (...args: any[]) => any;
      onHeyJarvisStatus: (...args: any[]) => any;
      onHeyJarvisError: (...args: any[]) => any;
      setWakeWordEnabled: (...args: any[]) => any;
      setWakeWordSensitivity: (...args: any[]) => any;
      setWakeWordMicInUse: (...args: any[]) => any;
      getTouchInputStatus: (...args: any[]) => any;
      onTouchInputStatus: (...args: any[]) => any;
      setWindowOpaque: (...args: any[]) => any;
      socialStart: (...args: any[]) => any;
      socialStop: (...args: any[]) => any;
      socialSetBounds: (...args: any[]) => any;
      socialNavigate: (...args: any[]) => any;
      socialNavigateAll: (...args: any[]) => any;
      socialReload: (...args: any[]) => any;
      socialHome: (...args: any[]) => any;
      socialGetUrl: (...args: any[]) => any;
      socialCaptureHtml: (...args: any[]) => any;
      socialExec: (...args: any[]) => any;
      socialPostReply: (...args: any[]) => any;
    };
  }
}
