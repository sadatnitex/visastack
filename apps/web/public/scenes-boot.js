/* WP-PUB1 (ADR 0029, MOT1): the early scenes mark, run in the head before the first paint. Same rule
   as the runtime (scene-engine.ts sceneMode): less motion asks for "gentle", else SCENE_SCREEN_QUERY
   picks "pinned" (data-scenes="live") or "reveal". data-scene-mode names the mode. Never throws. */
(() => {
  try {
    const matches = (query) => matchMedia(query).matches;
    const mode = matches('(prefers-reduced-motion: reduce)')
      ? 'gentle'
      : matches('(min-width: 760px) and (min-height: 600px)')
        ? 'pinned'
        : 'reveal';
    const root = document.documentElement;
    root.setAttribute('data-scenes', mode === 'pinned' ? 'live' : mode);
    root.setAttribute('data-scene-mode', mode);
  } catch {}
})();
