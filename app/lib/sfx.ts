/**
 * Lightweight SFX player. Caches Audio objects so repeated calls don't
 * re-parse the file. Each call to play() interrupts the previous instance
 * of the same sound so rapid clicks don't stack infinitely.
 */

const cache: Record<string, HTMLAudioElement> = {};

/** Counter to detect stale closures on rapid re-plays of the same cached Audio element. */
let rateGen = 0;

export type SFXName =
  | 'intro_sfx'
  | 'intro2'
  | 'loading'
  | 'app_close'
  | 'error'
  | 'calculating'
  | 'notification'
  | 'sfx_settings_open'
  | 'switch_interface'
  | 'select'
  | 'click_sfx'
  | 'click'
  | 'select_confirm'
  | 'slide1'
  | 'slide2'
  | 'slide3'
  | 'jarvis_simulating'
  | 'jarvis_simulating_web_fluid'
  | 'jarvis_failed'
  | 'jarvis_success'
  | 'jarvis_success_web_fluid'
  | 'jarvis_active_ingredients'
  | 'jarvis_intro_preferences';

const FILE_MAP: Record<SFXName, string> = {
  intro_sfx:        '/assets/SFX/intro_sfx.mp3',
  intro2:           '/assets/SFX/intro2.MP3',
  loading:          '/assets/SFX/loading.mp3',
  app_close:        '/assets/SFX/app_close.mp3',
  error:            '/assets/SFX/error.mp3',
  calculating:      '/assets/SFX/calculating.wav',
  notification:     '/assets/SFX/notification.wav',
  sfx_settings_open:'/assets/SFX/sfx_settings_open.mp3',
  switch_interface: '/assets/SFX/switch_interface.mp3',
  select:           '/assets/SFX/select.mp3',
  click_sfx:        '/assets/SFX/click_sfx.wav',
  click:            '/assets/SFX/click.wav',
  select_confirm:   '/assets/SFX/select.wav',
  slide1:           '/assets/SFX/slide.MP3',
  slide2:           '/assets/SFX/slide2.MP3',
  slide3:           '/assets/SFX/slide3.MP3',
  jarvis_simulating: '/assets/SFX/jarvis-simulating.mp3',
  jarvis_simulating_web_fluid: '/assets/SFX/jarvis-simulating-web-fluid.mp3',
  jarvis_failed: '/assets/SFX/jarvis-failed.mp3',
  jarvis_success: '/assets/SFX/jarvis-success.mp3',
  jarvis_success_web_fluid: '/assets/SFX/jarvis-success-web-fluid-is-sufficiently-condu.mp3',
  jarvis_active_ingredients: '/assets/SFX/jarvis-active-ingredient-xantham-gum-and-sodium.mp3',
  jarvis_intro_preferences: '/assets/SFX/intro/jarvis-importing-all-preferences-from-home-inte.mp3',
};

const SLIDE_SFX: SFXName[] = ['slide1', 'slide2', 'slide3'];

export function sfx(name: SFXName, volume = 1, rate = 1): void {
  if (typeof window === 'undefined') return;
  try {
    let audio = cache[name];
    if (!audio) {
      audio = new Audio(FILE_MAP[name]);
      cache[name] = audio;
    }
    audio.volume = Math.max(0, Math.min(1, volume));
    audio.currentTime = 0;
    audio.playbackRate = rate;
    const thisGen = ++rateGen;
    audio.dataset['rateGen'] = String(thisGen);
    void audio.play().then(() => {
      // Stale — a newer call has taken over the shared Audio element
      if (audio.dataset['rateGen'] !== String(thisGen)) return;
      // Re-assert after play() resolves — beats the Chromium quirk
      // where seeking or ended-state can silently reset playbackRate to 1.0
      if (audio.playbackRate !== rate) {
        audio.playbackRate = rate;
      }
    }).catch(() => { /* user hasn't interacted yet — silent fail */ });
  } catch {
    // Non-critical — never throw
  }
}

/** Play a random slide sound — used for widget fly-out animations. */
export function sfxSlide(volume = 1): void {
  const pick = SLIDE_SFX[Math.floor(Math.random() * SLIDE_SFX.length)];
  sfx(pick, volume);
}

/** Play an SFX and resolve when it finishes (fresh Audio instance — safe for voice lines). */
export function playSfxAwait(name: SFXName, volume = 1): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  return new Promise((resolve) => {
    try {
      const audio = new Audio(FILE_MAP[name]);
      audio.volume = Math.max(0, Math.min(1, volume));
      const done = () => {
        audio.removeEventListener('ended', done);
        audio.removeEventListener('error', done);
        resolve();
      };
      audio.addEventListener('ended', done);
      audio.addEventListener('error', done);
      void audio.play().catch(() => resolve());
    } catch {
      resolve();
    }
  });
}

export function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
