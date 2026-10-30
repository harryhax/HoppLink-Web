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

/**
 * A Bootstrap confirmation dialog. Resolves true only if the user presses the confirm button.
 * `question` is { title, body, confirm, danger }; all text is inserted as text, never as HTML.
 */
export async function confirmDialog(question) {
  const { default: Modal } = await import('bootstrap/js/dist/modal.js');
  const element = html(`
    <div class="modal fade" tabindex="-1" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header"><h2 class="modal-title h5" data-title></h2>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Cancel"></button></div>
          <div class="modal-body small" data-body></div>
          <div class="modal-footer">
            <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel</button>
            <button type="button" class="btn" data-confirm></button>
          </div>
        </div>
      </div>
    </div>`);
  text(element, '[data-title]', question.title);
  text(element, '[data-body]', question.body);
  const confirmButton = element.querySelector('[data-confirm]');
  confirmButton.textContent = question.confirm;
  confirmButton.classList.add(question.danger ? 'btn-danger' : 'btn-primary');
  document.body.append(element);

  const modal = new Modal(element);
  return new Promise((resolve) => {
    let confirmed = false;
    confirmButton.addEventListener('click', () => { confirmed = true; modal.hide(); });
    element.addEventListener('hidden.bs.modal', () => { modal.dispose(); element.remove(); resolve(confirmed); }, { once: true });
    modal.show();
  });
}
