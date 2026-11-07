import { formatDate, formatSize, loadDownloads } from '../downloads.js';
import { html, setErrorBanner, text } from '../dom.js';

/**
 * The public downloads page at /downloads. No sign-in: it never calls the API, only fetches the release manifest.
 * Every value from the manifest is inserted as text, and links come only from downloadUrl(), never the manifest.
 * Elements switched with `hidden` carry no Bootstrap display utility, so `hidden` always wins.
 */
export function renderDownloads({ fetch } = {}) {
  document.title = 'Download HoppLink';
  const page = html(`
    <div class="pm-downloads">
      <header class="bg-white border-bottom">
        <div class="container pm-downloads-container d-flex align-items-center justify-content-between py-3">
          <a class="d-flex align-items-center text-decoration-none" href="/downloads">
            <img class="pm-logo pm-logo-md" src="/brand/hopplink-logo-on-light.png" alt="HoppLink" width="678" height="120">
          </a>
          <a class="btn btn-outline-secondary btn-sm" href="/login">Sign in</a>
        </div>
      </header>

      <main class="container pm-downloads-container py-5">
        <section class="pm-platforms mb-5" aria-labelledby="pm-platforms-title" data-platforms>
          <h2 class="h5 fw-semibold text-center mb-2" id="pm-platforms-title">Supported Trading Platforms</h2>
          <p class="text-center text-body-secondary small mb-4">HoppLink can be used with these platforms. Each platform's own terms and regional restrictions still apply, so not every platform is available everywhere.</p>
          <ul class="row row-cols-2 row-cols-md-4 g-3 list-unstyled mb-0">
            <li class="col"><div class="pm-platform"><img class="pm-platform-logo" src="/brands/polymarket.svg" alt="Polymarket" width="911" height="168" loading="lazy" decoding="async"></div></li>
            <li class="col"><div class="pm-platform"><img class="pm-platform-logo" src="/brands/binance.svg" alt="Binance" width="632" height="127" loading="lazy" decoding="async"></div></li>
            <li class="col"><div class="pm-platform"><img class="pm-platform-logo" src="/brands/bingx.svg" alt="BingX" width="76" height="24" loading="lazy" decoding="async"></div></li>
            <li class="col"><div class="pm-platform"><img class="pm-platform-logo" src="/brands/bybit.svg" alt="Bybit" width="300" height="100" loading="lazy" decoding="async"></div></li>
            <li class="col"><div class="pm-platform"><img class="pm-platform-logo" src="/brands/htx.png" alt="HTX" width="374" height="144" loading="lazy" decoding="async"></div></li>
            <li class="col"><div class="pm-platform"><img class="pm-platform-logo" src="/brands/kalshi.svg" alt="Kalshi" width="772" height="226" loading="lazy" decoding="async"></div></li>
            <li class="col"><div class="pm-platform"><img class="pm-platform-logo" src="/brands/okx.svg" alt="OKX" width="157" height="44" loading="lazy" decoding="async"></div></li>
            <li class="col"><div class="pm-platform"><img class="pm-platform-logo" src="/brands/pionex.png" alt="Pionex" width="378" height="66" loading="lazy" decoding="async"></div></li>
          </ul>
          <p class="text-center text-body-secondary small mt-3 mb-0">HoppLink is an independent service and is not affiliated with or endorsed by the platforms shown.</p>
        </section>

        <div class="text-center mb-4">
          <span class="badge rounded-pill text-bg-warning mb-3">Beta</span>
          <h1 class="h2 fw-semibold mb-2">Download HoppLink</h1>
          <p class="text-body-secondary mb-0">The desktop app for Windows and macOS. Sign in with your HoppLink account.</p>
        </div>

        <div class="text-center text-body-secondary small py-5" data-loading role="status">
          <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Loading downloads…
        </div>

        <div data-error hidden>
          <div class="alert alert-danger d-flex align-items-center gap-2" role="alert">
            <i class="bi bi-exclamation-triangle" aria-hidden="true"></i>
            <span class="flex-grow-1" data-error-text></span>
            <button class="btn btn-sm btn-outline-danger" type="button" data-retry>Retry</button>
          </div>
        </div>

        <div data-empty hidden>
          <div class="card shadow-sm text-center">
            <div class="card-body p-5">
              <i class="bi bi-cloud-arrow-down pm-downloads-empty-icon text-primary" aria-hidden="true"></i>
              <h2 class="h5 mt-3 mb-2">Downloads coming soon</h2>
              <p class="text-body-secondary mb-0">The HoppLink desktop app isn't available to download yet. Please check back shortly.</p>
            </div>
          </div>
        </div>

        <div data-ready hidden>
          <p class="text-center text-body-secondary small mb-4" data-summary></p>
          <div class="row g-3 justify-content-center" data-builds></div>
          <section class="card shadow-sm mt-4" data-notes-section hidden>
            <div class="card-body">
              <h2 class="h6 mb-2">What's new</h2>
              <ul class="small mb-0" data-notes></ul>
            </div>
          </section>
        </div>

        <p class="small text-body-secondary text-center mt-5 mb-0">
          <i class="bi bi-info-circle me-1" aria-hidden="true"></i>
          HoppLink is beta software. It may contain bugs, and features may change without notice.
        </p>
      </main>
    </div>`);

  const loading = page.querySelector('[data-loading]');
  const errorBox = page.querySelector('[data-error]');
  const empty = page.querySelector('[data-empty]');
  const ready = page.querySelector('[data-ready]');

  function show(state) {
    loading.hidden = state !== 'loading';
    empty.hidden = state !== 'empty';
    ready.hidden = state !== 'ready';
  }

  function showRelease(release) {
    const parts = [release.version && `Version ${release.version}`, formatDate(release.releaseDate) && `released ${formatDate(release.releaseDate)}`];
    text(page, '[data-summary]', parts.filter(Boolean).join(', '));
    page.querySelector('[data-builds]').replaceChildren(...release.downloads.map(buildCard));
    const notes = page.querySelector('[data-notes]');
    notes.replaceChildren(...release.notes.map((note) => {
      const item = document.createElement('li');
      item.textContent = note;
      return item;
    }));
    page.querySelector('[data-notes-section]').hidden = release.notes.length === 0;
  }

  async function load() {
    setErrorBanner(errorBox, null);
    show('loading');
    const result = await loadDownloads(fetch ? { fetch } : {});
    if (result.state === 'error') {
      show('none');
      setErrorBanner(errorBox, result.message, { failed: true });
      return;
    }
    if (result.state === 'ready') showRelease(result);
    show(result.state);
  }

  page.querySelector('[data-retry]').addEventListener('click', load);
  load();
  return page;
}

/** One platform's card. Text only from the validated build; the link is its downloadUrl(). */
function buildCard(build) {
  const card = html(`
    <div class="col-12 col-md-6 col-lg-4">
      <div class="card shadow-sm h-100">
        <div class="card-body d-flex flex-column">
          <div class="d-flex align-items-center gap-3 mb-3">
            <div class="pm-stat-icon"><i class="bi" aria-hidden="true" data-icon></i></div>
            <div class="min-w-0">
              <h2 class="h6 mb-0" data-os></h2>
              <div class="small text-body-secondary" data-arch></div>
            </div>
          </div>
          <dl class="pm-details small mb-3">
            <dt>Version</dt><dd data-version></dd>
            <div data-date-row><dt>Released</dt><dd data-date></dd></div>
            <div data-size-row><dt>Size</dt><dd data-size></dd></div>
          </dl>
          <a class="btn btn-primary w-100 mt-auto" data-link download>
            <i class="bi bi-download me-2" aria-hidden="true"></i><span data-link-text></span>
          </a>
          <details class="small mt-2" data-checksum-row>
            <summary class="text-body-secondary">SHA-256 checksum</summary>
            <code class="d-block text-break mt-1" data-checksum></code>
          </details>
        </div>
      </div>
    </div>`);
  card.querySelector('[data-icon]').classList.add(build.icon);
  text(card, '[data-os]', build.os);
  text(card, '[data-arch]', build.arch);
  text(card, '[data-version]', build.version);
  const date = formatDate(build.releaseDate);
  text(card, '[data-date]', date);
  card.querySelector('[data-date-row]').hidden = date === null;
  const size = formatSize(build.size);
  text(card, '[data-size]', size);
  card.querySelector('[data-size-row]').hidden = size === null;
  text(card, '[data-checksum]', build.sha256);
  card.querySelector('[data-checksum-row]').hidden = build.sha256 === null;

  const link = card.querySelector('[data-link]');
  link.href = build.url;
  link.setAttribute('download', build.file);
  link.setAttribute('aria-label', `Download HoppLink ${build.version} for ${build.os} ${build.arch}`);
  text(card, '[data-link-text]', `Download for ${build.os}`);
  return card;
}
