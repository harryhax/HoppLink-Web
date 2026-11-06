import { html, setErrorBanner, text } from '../dom.js';
import { transferHash, userHash } from '../router.js';
import {
  PERIODS, TERMS, barLabel, describePeriod, formatAverage, formatBytes, formatCount, formatDateTime, formatDay,
  formatExactBytes, loadOverview, toCounter,
} from '../usage.js';

const PRIMARY_CARDS = [
  { key: 'bytesTotal', label: TERMS.total, icon: 'bi-arrow-down-up', bytes: true, primary: true },
  { key: 'bytesDown', label: TERMS.down, icon: 'bi-cloud-arrow-down', bytes: true, note: 'Destination → client' },
  { key: 'bytesUp', label: TERMS.up, icon: 'bi-cloud-arrow-up', bytes: true, note: 'Client → destination' },
  { key: 'transactions', label: TERMS.transactions, icon: 'bi-plug', note: 'HTTPS tunnels and HTTP requests, counted at close' },
];

function card({ key, label, icon, primary }) {
  return `
    <div class="col-12 col-sm-6 col-xl-3">
      <div class="card shadow-sm h-100 pm-stat${primary ? ' pm-stat-primary' : ''}" data-card="${key}">
        <div class="card-body d-flex align-items-start gap-3">
          <div class="pm-stat-icon"><i class="bi ${icon}" aria-hidden="true"></i></div>
          <div class="min-w-0">
            <div class="small text-body-secondary">${label}</div>
            <div class="pm-stat-value text-truncate placeholder-glow" data-value><span class="placeholder col-6"></span></div>
            <div class="small text-body-secondary" data-note></div>
          </div>
        </div>
      </div>
    </div>`;
}

const periodButtons = () => PERIODS.map((p) => `<button type="button" class="btn btn-outline-primary" data-period="${p.id}">${p.label}</button>`).join('');

/** Data Transfer: network-wide transfer and completed connections for a UTC period, by user and server. */
export function renderDataTransfer({ api, onAuthLost, route }) {
  const page = html(`
    <div>
      <div class="d-flex flex-wrap align-items-start gap-2 mb-3">
        <div class="me-auto">
          <h1 class="h4 mb-1">Data Transfer</h1>
          <p class="text-body-secondary mb-0">Data transferred through the proxy network, and completed connections.</p>
        </div>
        <div class="btn-group btn-group-sm" role="group" aria-label="Reporting period">${periodButtons()}</div>
        <button class="btn btn-sm btn-outline-primary" data-refresh>
          <span class="spinner-border spinner-border-sm me-1" hidden aria-hidden="true"></span><i class="bi bi-arrow-clockwise me-1" aria-hidden="true"></i>Refresh
        </button>
      </div>
      <p class="small text-body-secondary mb-4"><i class="bi bi-calendar3 me-1" aria-hidden="true"></i>Reporting period: <span class="fw-medium" data-period-text>…</span></p>

      <div class="alert alert-danger d-flex align-items-center gap-2" data-error hidden role="alert">
        <i class="bi bi-exclamation-triangle" aria-hidden="true"></i><span class="me-auto" data-error-text></span>
        <button class="btn btn-sm btn-outline-danger" data-retry>Retry</button>
      </div>

      <div data-report>
        <div class="row g-3 mb-3">${PRIMARY_CARDS.map(card).join('')}</div>
        <div class="row g-3 mb-3 small">
          <div class="col-12 col-md-4"><div class="card shadow-sm h-100"><div class="card-body py-2">
            <div class="text-body-secondary">${TERMS.users}</div><div class="fw-semibold fs-5" data-secondary="users">—</div></div></div></div>
          <div class="col-12 col-md-4"><div class="card shadow-sm h-100"><div class="card-body py-2">
            <div class="text-body-secondary">${TERMS.average}</div><div class="fw-semibold fs-5" data-secondary="average">—</div></div></div></div>
          <div class="col-12 col-md-4"><div class="card shadow-sm h-100"><div class="card-body py-2">
            <div class="text-body-secondary">${TERMS.lastActivity}</div><div class="fw-semibold fs-6 pt-1" data-secondary="last">—</div></div></div></div>
        </div>
        <div class="alert alert-light border small d-flex gap-2 mb-4"><i class="bi bi-info-circle" aria-hidden="true"></i><span>${TERMS.note}</span></div>
        <div class="alert alert-secondary small mb-4" data-empty hidden>No usage has been reported for this period yet. Figures appear once a proxy server's usage collector has delivered completed connections.</div>

        <div class="card shadow-sm mb-4">
          <div class="card-header bg-white d-flex flex-wrap align-items-center gap-2">
            <span class="fw-semibold me-auto"><i class="bi bi-bar-chart me-2 text-primary" aria-hidden="true"></i>Daily Data Transferred <span class="small text-body-secondary fw-normal" data-chart-range></span></span>
            <span class="small text-body-secondary"><span class="pm-swatch pm-swatch-down"></span>${TERMS.down}</span>
            <span class="small text-body-secondary"><span class="pm-swatch pm-swatch-up"></span>${TERMS.up}</span>
          </div>
          <div class="card-body">
            <div class="small text-body-secondary mb-1" data-chart-max></div>
            <div class="pm-chart" data-chart role="img"></div>
            <div class="d-flex justify-content-between small text-body-secondary mt-1" data-chart-axis></div>
            <details class="mt-3 small">
              <summary class="text-body-secondary">Daily figures (table)</summary>
              <div class="table-responsive mt-2" style="max-height: 320px">
                <table class="table table-sm align-middle mb-0">
                  <thead class="table-light"><tr><th scope="col">Date (UTC)</th><th scope="col" class="text-end">${TERMS.down}</th>
                    <th scope="col" class="text-end">${TERMS.up}</th><th scope="col" class="text-end">Total</th><th scope="col" class="text-end">${TERMS.transactionsShort}</th></tr></thead>
                  <tbody data-chart-table></tbody>
                </table>
              </div>
            </details>
          </div>
        </div>

        <div class="card shadow-sm mb-4">
          <div class="card-header bg-white fw-semibold"><i class="bi bi-plug me-2 text-primary" aria-hidden="true"></i>Connection Statistics</div>
          <div class="card-body small">
            <dl class="row mb-2 pm-details">
              <dt class="col-sm-5">${TERMS.transactions}</dt><dd class="col-sm-7" data-conn="total"></dd>
              <dt class="col-sm-5">Attributed to users</dt><dd class="col-sm-7" data-conn="attributed"></dd>
              <dt class="col-sm-5">Unattributed (unknown proxy username)</dt><dd class="col-sm-7" data-conn="unattributed"></dd>
              <dt class="col-sm-5">${TERMS.average}</dt><dd class="col-sm-7" data-conn="average"></dd>
            </dl>
            <p class="text-body-secondary mb-0">${TERMS.averageNote} Per-user and per-server connection totals are in the tables below.
              Connection durations and currently open connections are not measured yet.</p>
          </div>
        </div>

        <div class="card shadow-sm mb-4">
          <div class="card-header bg-white fw-semibold"><i class="bi bi-people me-2 text-primary" aria-hidden="true"></i>Usage by User</div>
          <div class="table-responsive">
            <table class="table table-hover align-middle mb-0 small">
              <thead class="table-light"><tr>
                <th scope="col">User</th><th scope="col" class="text-end">${TERMS.down}</th><th scope="col" class="text-end">${TERMS.up}</th>
                <th scope="col" class="text-end">Total <i class="bi bi-arrow-down" aria-label="sorted, largest first"></i></th>
                <th scope="col" class="text-end">${TERMS.transactionsShort}</th><th scope="col">Last Active</th>
              </tr></thead>
              <tbody data-users></tbody>
            </table>
          </div>
          <div class="card-footer bg-white d-flex flex-wrap align-items-center gap-2 small">
            <span class="text-body-secondary me-auto" data-users-summary></span>
            <button class="btn btn-sm btn-outline-secondary" data-prev><i class="bi bi-chevron-left"></i> Previous</button>
            <span data-page-label></span>
            <button class="btn btn-sm btn-outline-secondary" data-next>Next <i class="bi bi-chevron-right"></i></button>
          </div>
        </div>

        <div class="card shadow-sm">
          <div class="card-header bg-white fw-semibold"><i class="bi bi-hdd-network me-2 text-primary" aria-hidden="true"></i>Usage by Proxy Server</div>
          <div class="table-responsive">
            <table class="table table-hover align-middle mb-0 small">
              <thead class="table-light"><tr>
                <th scope="col">Server</th><th scope="col" class="text-end">${TERMS.down}</th><th scope="col" class="text-end">${TERMS.up}</th>
                <th scope="col" class="text-end">Total <i class="bi bi-arrow-down" aria-label="sorted, largest first"></i></th>
                <th scope="col" class="text-end">${TERMS.transactionsShort}</th>
                <th scope="col" class="text-end" title="Users with recorded activity on this server in the period">Active Users</th>
              </tr></thead>
              <tbody data-servers></tbody>
            </table>
          </div>
          <div class="card-footer bg-white small text-body-secondary">Server totals include usage from unknown proxy usernames (unattributed), which is never assigned to a user.</div>
        </div>
      </div>
    </div>`);

  const report = page.querySelector('[data-report]');
  const errorBox = page.querySelector('[data-error]');
  const refresh = page.querySelector('[data-refresh]');
  const prev = page.querySelector('[data-prev]');
  const next = page.querySelector('[data-next]');

  for (const button of page.querySelectorAll('[data-period]')) {
    const active = button.dataset.period === route.period;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
    button.addEventListener('click', () => { location.hash = transferHash({ period: button.dataset.period, page: 1 }); });
  }
  prev.addEventListener('click', () => { location.hash = transferHash({ period: route.period, page: route.page - 1 }); });
  next.addEventListener('click', () => { location.hash = transferHash({ period: route.period, page: route.page + 1 }); });

  function setLoading(loading) {
    refresh.disabled = loading;
    refresh.querySelector('.spinner-border').hidden = !loading;
    refresh.querySelector('.bi').hidden = loading;
    if (loading) prev.disabled = next.disabled = true;
  }

  const cell = (markup, value, title) => {
    const element = html(markup);
    element.textContent = value;
    if (title) element.title = title;
    return element;
  };
  const bytesCell = (value) => cell('<td class="text-end text-nowrap"></td>', formatBytes(value), formatExactBytes(value));
  const countCell = (value) => cell('<td class="text-end"></td>', formatCount(value));
  const message = (body, columns, words) => {
    body.replaceChildren(html(`<tr><td colspan="${columns}" class="text-center text-body-secondary py-4"></td></tr>`));
    text(body, 'td', words);
  };

  function showCards({ total, unattributed }) {
    for (const def of PRIMARY_CARDS) {
      const element = page.querySelector(`[data-card="${def.key}"]`);
      const value = element.querySelector('[data-value]');
      value.classList.remove('placeholder-glow');
      value.textContent = def.bytes ? formatBytes(total[def.key]) : formatCount(total[def.key]);
      value.title = def.bytes ? formatExactBytes(total[def.key]) : '';
      let note = def.note ?? '';
      if (def.key === 'bytesTotal') {
        note = toCounter(unattributed?.bytesTotal) > 0n ? `Includes ${formatBytes(unattributed.bytesTotal)} unattributed` : 'Downloaded + uploaded';
      }
      text(element, '[data-note]', note);
    }
  }

  function showSecondary(summary) {
    text(page, '[data-secondary="users"]', summary.attributed.users.toLocaleString());
    text(page, '[data-secondary="average"]', formatAverage(summary.total.avgBytesPerTransaction));
    text(page, '[data-secondary="last"]', formatDateTime(summary.total.lastActivityAt));
    text(page, '[data-conn="total"]', formatCount(summary.total.transactions));
    text(page, '[data-conn="attributed"]', formatCount(summary.attributed.transactions));
    text(page, '[data-conn="unattributed"]', formatCount(summary.unattributed?.transactions ?? '0'));
    text(page, '[data-conn="average"]', formatAverage(summary.total.avgBytesPerTransaction));
  }

  function showChart(chart) {
    text(page, '[data-chart-range]', `· ${chart.label}`);
    const box = page.querySelector('[data-chart]');
    const axis = page.querySelector('[data-chart-axis]');
    const table = page.querySelector('[data-chart-table]');
    text(page, '[data-chart-max]', chart.empty ? '' : `Largest day: ${formatBytes(chart.max)}`);
    box.setAttribute('aria-label', chart.empty
      ? `No data transferred: ${chart.label}.`
      : `Daily data transferred, ${chart.label}; largest day ${formatBytes(chart.max)}. The same figures are in the table below.`);

    if (chart.empty) {
      box.replaceChildren(html('<div class="pm-chart-empty small text-body-secondary">No data transferred in this range.</div>'));
    } else {
      box.replaceChildren(...chart.bars.map((bar) => {
        const column = html('<div class="pm-bar"><div class="pm-bar-up"></div><div class="pm-bar-down"></div></div>');
        column.title = barLabel(bar);
        const up = column.querySelector('.pm-bar-up');
        const down = column.querySelector('.pm-bar-down');
        up.style.height = `${bar.upPercent}%`;
        down.style.height = `${bar.downPercent}%`;
        // The rounded end sits on whichever segment is on top; a 2px gap separates the two.
        if (bar.upPercent === 0) down.classList.add('pm-bar-top');
        else up.classList.add('pm-bar-top');
        if (bar.upPercent > 0 && bar.downPercent > 0) up.classList.add('pm-bar-gap');
        return column;
      }));
    }
    const bars = chart.bars;
    const labels = bars.length > 2 ? [bars[0], bars[Math.floor(bars.length / 2)], bars.at(-1)] : bars;
    axis.replaceChildren(...labels.map((bar) => cell('<span></span>', formatDay(bar.date))));
    table.replaceChildren(...[...bars].reverse().map((bar) => {
      const row = html('<tr></tr>');
      row.append(cell('<td class="text-nowrap"></td>', formatDay(bar.date)), bytesCell(bar.bytesDown), bytesCell(bar.bytesUp), bytesCell(bar.bytesTotal), countCell(bar.transactions));
      return row;
    }));
  }

  function showUsers(data) {
    const body = page.querySelector('[data-users]');
    const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
    text(page, '[data-users-summary]', `${data.withUsage.toLocaleString()} of ${data.total.toLocaleString()} ${data.total === 1 ? 'user' : 'users'} with recorded activity`);
    text(page, '[data-page-label]', `Page ${data.page} of ${pages}`);
    prev.disabled = data.page <= 1;
    next.disabled = data.page >= pages;
    if (data.users.length === 0) {
      message(body, 6, data.total === 0 ? 'No users yet.' : 'No users on this page.');
      return;
    }
    body.replaceChildren(...data.users.map((u) => {
      const row = html('<tr><td><a data-c="name"></a><div class="text-body-secondary text-break" data-c="email"></div></td></tr>');
      const link = row.querySelector('[data-c="name"]');
      link.href = userHash(u.id);
      link.textContent = u.name || u.email;
      text(row, '[data-c="email"]', u.name ? u.email : '');
      const idle = u.lastActivityAt === null;
      row.append(bytesCell(u.bytesDown), bytesCell(u.bytesUp), cell('<td class="text-end text-nowrap fw-medium"></td>', formatBytes(u.bytesTotal), formatExactBytes(u.bytesTotal)),
        countCell(u.transactions), cell('<td class="text-nowrap"></td>', idle ? 'No activity' : formatDateTime(u.lastActivityAt)));
      if (idle) row.classList.add('text-body-secondary');
      return row;
    }));
  }

  function showServers(servers) {
    const body = page.querySelector('[data-servers]');
    if (servers.length === 0) {
      message(body, 6, 'No proxy servers.');
      return;
    }
    body.replaceChildren(...servers.map((s) => {
      const row = html('<tr><td><span data-c="name"></span> <span class="badge text-bg-secondary" data-c="disabled" hidden>Disabled</span><div class="text-body-secondary" data-c="note"></div></td></tr>');
      text(row, '[data-c="name"]', s.name);
      row.querySelector('[data-c="disabled"]').hidden = s.enabled;
      text(row, '[data-c="note"]', toCounter(s.unattributed.bytesTotal) > 0n ? `Includes ${formatBytes(s.unattributed.bytesTotal)} unattributed` : '');
      row.append(bytesCell(s.bytesDown), bytesCell(s.bytesUp), cell('<td class="text-end text-nowrap fw-medium"></td>', formatBytes(s.bytesTotal), formatExactBytes(s.bytesTotal)),
        countCell(s.transactions), cell('<td class="text-end"></td>', s.users.toLocaleString()));
      return row;
    }));
  }

  let latest = 0;
  async function load() {
    const request = ++latest;
    setLoading(true);
    setErrorBanner(errorBox, null);
    const result = await loadOverview(api, { period: route.period, page: route.page });
    if (request !== latest || !page.isConnected) return;
    setLoading(false);

    if (result.state !== 'ready') {
      // Never leave stale or partial figures on screen.
      report.hidden = true;
      if (result.state === 'auth' && (await onAuthLost?.())) return;
      setErrorBanner(errorBox, result.state === 'auth'
        ? 'The server refused access to the data transfer report. Sign out and sign in again if this continues.'
        : result.message, { failed: true });
      return;
    }

    report.hidden = false;
    text(page, '[data-period-text]', describePeriod(result.period));
    page.querySelector('[data-empty]').hidden = toCounter(result.summary.total.transactions) > 0n;
    showCards(result.summary);
    showSecondary(result.summary);
    showChart(result.chart);
    showUsers(result.users);
    showServers(result.servers);
  }

  refresh.addEventListener('click', load);
  page.querySelector('[data-retry]').addEventListener('click', load);
  load();
  return page;
}
