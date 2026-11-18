/* WP-PUB1 (ADR 0029): the early scroll-scenes mark. Loaded in the page head with this request's
   nonce, before the first paint. Marks html[data-scenes="live"] only when motion is welcome, data
   saver is off and the screen is at least 760 x 600, the same tests as the scenes runtime
   (components/public-site/scene-engine.ts, SCENE_SCREEN_QUERY). Never throws. */
(() => {
  try {
    const root = document.documentElement;
    const matches = (query) => matchMedia(query).matches;
    if (
      !matches('(prefers-reduced-motion: reduce)') &&
      matches('(min-width: 760px) and (min-height: 600px)') &&
      !root.hasAttribute('data-save-data') &&
      !navigator.connection?.saveData
    )
      root.setAttribute('data-scenes', 'live');
  } catch {}
})();
