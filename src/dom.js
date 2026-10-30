/** Parses trusted, static markup. Never pass user or server data here; use text() for that. */
export function html(markup) {
  const template = document.createElement('template');
  template.innerHTML = markup.trim();
  return template.content.firstElementChild;
}

/** Sets text content of the element matching `selector` (safe for any data). */
export function text(root, selector, value) {
  const element = root.querySelector(selector);
  if (element) element.textContent = value ?? '';
}

export function showAlert(root, message, tone = 'danger') {
  const box = root.querySelector('[data-alert]');
  if (!box) return;
  box.className = `alert alert-${tone} py-2 small mb-3`;
  box.textContent = message ?? '';
  box.hidden = !message;
}
