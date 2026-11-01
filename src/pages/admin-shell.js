import { html, text } from '../dom.js';
import { parseRoute } from '../router.js';
import { renderDashboardContent } from './dashboard.js';
import { renderDataTransfer } from './data-transfer.js';
import { renderProxyServers } from './proxy-servers.js';
import { renderUserDetails } from './user-details.js';
import { renderUsers } from './users.js';

const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: 'bi-speedometer2', href: '#dashboard' },
  { id: 'users', label: 'Users', icon: 'bi-people', href: '#users' },
  { id: 'servers', label: 'Proxy Servers', icon: 'bi-hdd-network', href: '#servers' },
  { id: 'transfer', label: 'Data Transfer', icon: 'bi-arrow-down-up', href: '#transfer' },
];

function navItems() {
  return NAV.map((item) => `<li class="nav-item"><a class="nav-link" data-nav="${item.id}" href="${item.href}"><i class="bi ${item.icon}"></i><span>${item.label}</span></a></li>`).join('');
}

/**
 * Administrator layout: sidebar, top bar and a content area chosen by the URL hash. Display only:
 * every admin endpoint is enforced by the server.
 */
export function renderAdminShell({ user, api, onSignOut, onAuthLost }) {
  const shell = html(`
    <div class="pm-shell">
      <aside class="pm-sidebar offcanvas-lg offcanvas-start" tabindex="-1" id="pm-sidebar" aria-label="Navigation">
        <div class="offcanvas-header border-bottom d-lg-none">
          <span class="fw-semibold">ProxyMarket</span>
          <button type="button" class="btn-close" data-bs-dismiss="offcanvas" data-bs-target="#pm-sidebar" aria-label="Close"></button>
        </div>
        <div class="offcanvas-body d-flex flex-column p-0">
          <div class="pm-sidebar-brand d-none d-lg-flex"><img src="/favicon.svg" alt="" width="26" height="26"><span>ProxyMarket</span><span class="badge text-bg-primary-subtle text-primary-emphasis ms-1">Admin</span></div>
          <ul class="nav flex-column pm-nav">${navItems()}</ul>
        </div>
      </aside>

      <div class="pm-main">
        <nav class="navbar bg-white border-bottom px-3 px-lg-4 sticky-top">
          <button class="btn btn-sm btn-light border d-lg-none me-2" type="button" data-bs-toggle="offcanvas" data-bs-target="#pm-sidebar" aria-controls="pm-sidebar" aria-label="Open navigation">
            <i class="bi bi-list"></i>
          </button>
          <span class="navbar-brand d-lg-none fw-semibold me-auto">ProxyMarket</span>
          <div class="ms-auto d-flex align-items-center gap-3">
            <span class="small text-body-secondary d-none d-sm-inline"><i class="bi bi-person-circle me-1"></i><span data-who></span></span>
            <button class="btn btn-sm btn-outline-secondary" data-signout><i class="bi bi-box-arrow-right me-1"></i>Sign out</button>
          </div>
        </nav>
        <main class="p-3 p-lg-4" data-content></main>
      </div>
    </div>`);

  text(shell, '[data-who]', user.name || user.email);
  shell.querySelector('[data-signout]').addEventListener('click', onSignOut);
  const content = shell.querySelector('[data-content]');

  function show() {
    // Once this shell has been replaced (e.g. after sign-out), stop following the URL.
    if (!shell.isConnected) {
      window.removeEventListener('hashchange', show);
      return;
    }
    const route = parseRoute(location.hash);
    const section = route.name === 'user' ? 'users' : route.name;
    for (const link of shell.querySelectorAll('[data-nav]')) {
      const active = link.dataset.nav === section;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    const context = { user, api, onAuthLost };
    const page = route.name === 'users' ? renderUsers({ ...context, route })
      : route.name === 'user' ? renderUserDetails({ ...context, id: route.id })
        : route.name === 'servers' ? renderProxyServers(context)
          : route.name === 'transfer' ? renderDataTransfer({ ...context, route })
            : renderDashboardContent(context);
    content.replaceChildren(page);
    window.scrollTo(0, 0);
  }

  window.addEventListener('hashchange', show);
  queueMicrotask(show);
  return shell;
}
