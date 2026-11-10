// src/ui/library.js
// Owns: the collapsible saved-model panel - a header with a summary line, a
// scrollable list of cards (thumbnail, name, size + age, delete) and the empty /
// loading / unsupported states.
//
// Presentational only: it never touches IndexedDB. main.js loads the records and
// calls refresh(); the panel reports intent (onSelect, onDelete, onRetry).
// Card text is set with textContent, never innerHTML, because a file name is user
// input.

import { formatAddedAt, formatBytes, librarySummary } from '../library/records.js';

const ICON_LIBRARY = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 5.6h4.2v13H4zM9.9 5.6h4.2v13H9.9z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="m16.4 6.1 3.3 12.4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;

const ICON_CLOSE = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m6.5 6.5 11 11m0-11-11 11" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`;

const ICON_DELETE = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5.5 7.5h13M9.5 7.5V5.4h5v2.1M7.4 7.5l.7 11.1h7.8l.7-11.1" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const ICON_EMPTY = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4.6 8.2 12 4l7.4 4.2v7.6L12 20l-7.4-4.2z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M4.6 8.2 12 12.4l7.4-4.2M12 12.4V20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>`;

/**
 * @param {HTMLElement} container
 * @param {{
 *   onSelect?: (id: string) => void,
 *   onDelete?: (id: string) => void,
 *   onRetry?: () => void,
 *   onClose?: () => void,
 * }} handlers
 */
export function createLibrary(container, { onSelect, onDelete, onRetry, onClose } = {}) {
  const element = document.createElement('aside');
  element.className = 'library';
  element.setAttribute('aria-label', 'Saved models');
  element.innerHTML = `
    <div class="library-head">
      <span class="library-mark">${ICON_LIBRARY}</span>
      <div class="library-heading">
        <h2 class="library-title">Library</h2>
        <p class="library-summary" data-role="summary">No saved models</p>
      </div>
      <button type="button" class="library-close" data-role="close" aria-label="Close library">
        ${ICON_CLOSE}
      </button>
    </div>
    <div class="library-body" data-role="body" role="list"></div>
  `;

  const summary = element.querySelector('[data-role="summary"]');
  const body = element.querySelector('[data-role="body"]');
  const closeButton = element.querySelector('[data-role="close"]');

  /** @type {'loading'|'ready'|'empty'|'error'|'unsupported'} */
  let status = 'loading';
  /** @type {string} */
  let statusMessage = '';
  /** @type {string|null} */
  let busyId = null;
  let open = false;

  function handleClose() {
    if (typeof onClose === 'function') onClose();
    else setOpen(false);
  }

  closeButton.addEventListener('click', handleClose);

  function setOpen(next) {
    open = Boolean(next);
    element.classList.toggle('is-open', open);
    element.setAttribute('aria-hidden', open ? 'false' : 'true');
  }

  function setSummary(text) {
    summary.textContent = text;
  }

  /**
   * @param {string} icon svg markup
   * @param {string} title
   * @param {string} detail
   * @param {string} [actionLabel] renders a button when given
   */
  function renderNotice(icon, title, detail, actionLabel) {
    const notice = document.createElement('div');
    notice.className = 'library-notice';
    notice.innerHTML = `<span class="library-notice-icon">${icon}</span>`;

    const heading = document.createElement('p');
    heading.className = 'library-notice-title';
    heading.textContent = title;
    notice.appendChild(heading);

    const text = document.createElement('p');
    text.className = 'library-notice-detail';
    text.textContent = detail;
    notice.appendChild(text);

    if (actionLabel) {
      const action = document.createElement('button');
      action.type = 'button';
      action.className = 'btn btn-small library-retry';
      action.textContent = actionLabel;
      action.addEventListener('click', () => {
        if (typeof onRetry === 'function') onRetry();
      });
      notice.appendChild(action);
    }

    body.appendChild(notice);
  }

  /**
   * @param {object} record
   * @returns {HTMLElement}
   */
  function renderCard(record) {
    const card = document.createElement('article');
    card.className = 'library-card';
    card.setAttribute('role', 'listitem');
    card.dataset.id = record.id;
    if (busyId === record.id) card.classList.add('is-busy');

    const openButton = document.createElement('button');
    openButton.type = 'button';
    openButton.className = 'library-open';
    openButton.setAttribute('aria-label', `Load ${record.name}`);
    openButton.disabled = Boolean(busyId);
    openButton.addEventListener('click', () => {
      if (typeof onSelect === 'function') onSelect(record.id);
    });

    const thumb = document.createElement('span');
    thumb.className = 'library-thumb';
    if (record.thumbnail) {
      const image = document.createElement('img');
      image.src = record.thumbnail;
      image.alt = '';
      image.loading = 'lazy';
      image.decoding = 'async';
      thumb.appendChild(image);
    } else {
      thumb.innerHTML = ICON_EMPTY;
      thumb.classList.add('is-placeholder');
    }

    const meta = document.createElement('span');
    meta.className = 'library-meta';

    const name = document.createElement('span');
    name.className = 'library-name';
    name.textContent = record.name;
    name.title = record.name;

    const sub = document.createElement('span');
    sub.className = 'library-sub';
    sub.textContent = `${formatBytes(record.size)} · ${formatAddedAt(record.addedAt, Date.now())}`;

    meta.append(name, sub);
    openButton.append(thumb, meta);

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'library-delete';
    removeButton.setAttribute('aria-label', `Delete ${record.name}`);
    removeButton.title = 'Delete from library';
    removeButton.disabled = Boolean(busyId);
    removeButton.innerHTML = ICON_DELETE;
    removeButton.addEventListener('click', (event) => {
      event.stopPropagation();
      if (typeof onDelete === 'function') onDelete(record.id);
    });

    card.append(openButton, removeButton);
    return card;
  }

  /**
   * Replace the whole list.
   *
   * @param {Array<object>} records already sanitised + sorted by main.js
   * @param {{ status?: typeof status, message?: string, busyId?: string|null }} [options]
   */
  function refresh(records, options = {}) {
    const list = Array.isArray(records) ? records : [];
    status = options.status ?? (list.length > 0 ? 'ready' : 'empty');
    statusMessage = options.message ?? '';
    busyId = options.busyId ?? null;

    body.replaceChildren();
    setSummary(librarySummary(list));

    if (status === 'unsupported') {
      setSummary('Unavailable');
      renderNotice(
        ICON_LIBRARY,
        'Saved models are unavailable',
        statusMessage || 'This browser does not allow local storage for this page.',
      );
      return;
    }

    if (status === 'error') {
      setSummary('Could not load');
      renderNotice(ICON_LIBRARY, 'Could not read the library', statusMessage || 'Storage failed.', 'Try again');
      return;
    }

    if (list.length === 0) {
      setSummary(status === 'loading' ? 'Loading…' : 'No saved models');
      renderNotice(
        ICON_EMPTY,
        status === 'loading' ? 'Reading saved models…' : 'Nothing saved yet',
        status === 'loading'
          ? 'One moment.'
          : 'Load a model and it appears here, ready to reopen after a reload.',
      );
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const record of list) fragment.appendChild(renderCard(record));
    body.appendChild(fragment);
  }

  container.appendChild(element);

  return {
    element,
    refresh,
    setOpen,
    isOpen: () => open,
    toggle() {
      setOpen(!open);
      return open;
    },
    /** Mark one card as loading (or clear it with null). */
    setBusy(id) {
      busyId = id ?? null;
      for (const card of body.querySelectorAll('.library-card')) {
        const busy = card.dataset.id === busyId;
        card.classList.toggle('is-busy', busy);
        for (const button of card.querySelectorAll('button')) button.disabled = busy || Boolean(busyId);
      }
    },
    dispose() {
      closeButton.removeEventListener('click', handleClose);
      element.remove();
    },
  };
}
