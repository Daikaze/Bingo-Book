const MOD = 'bingo-book';
const BOOKS = {
  bingo: 'Bingo Book',
  target: 'Target Book'
};
const STATUSES = ['None', 'Wanted', 'Dead', 'Captured', 'Missing', 'Cleared'];
const RANKS = ['S', 'A', 'B', 'C', 'D'];
const LEGACY_RANKS = { '5': 'S', '4': 'A', '3': 'B', '2': 'C', '1': 'D' };
const rankFor = value => RANKS.includes(String(value)) ? String(value) : (LEGACY_RANKS[String(value)] || 'D');
const BACKGROUNDS = {
  parchment: 'Parchment',
  page: 'Book Page',
  dark: 'Dark Page',
  clean: 'Clean Frame'
};

const S = {
  book: 'bingo',
  selected: null,
  showPlayers: false,
  chatOpen: false,
  chatAudience: 'everyone',
  chatRecipients: [],
  rankFilter: 'all'
};
let win = null;
let renderNonce = 0;
const localPageUpdates = new Set();

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const imgSrc = path => path ? (/^(https?:|data:|blob:)/i.test(path) ? path : foundry.utils.getRoute(path)) : '';

function renderApp(app) {
  if (!app) return;
  return app.render(true);
}

async function confirmDialog(title, content) {
  return Dialog.confirm({ title, content: `<p>${content}</p>` });
}

// Store browsing access per book, separate from one-time Chat whispers.
function permissions() { return game.settings.get(MOD, 'bookPermissions') || {}; }
function canSeeBook(book, user = game.user) {
  return !!BOOKS[book] && (user.isGM || !!permissions()[book]?.[user.id]);
}
function availableBooks(user = game.user) {
  return Object.keys(BOOKS).filter(book => canSeeBook(book, user));
}
function canSee(user = game.user) { return availableBooks(user).length > 0; }

function ownershipFor(book) {
  const ownership = { default: 0 };
  for (const u of game.users) if (!u.isGM && permissions()[book]?.[u.id]) ownership[u.id] = 2;
  return ownership;
}

// v0.3.0 had one shared allowlist. Copy it ONCE into both books to preserve
// existing access, then let each book be configured independently.
async function migratePermissions() {
  if (!game.user.isGM || game.settings.get(MOD, 'permissionsMigrated')) return;
  const legacy = game.settings.get(MOD, 'allowedUsers') || {};
  const saved = permissions();
  const next = {};
  for (const book of Object.keys(BOOKS)) next[book] = { ...legacy, ...(saved[book] || {}) };
  await game.settings.set(MOD, 'bookPermissions', next);
  await game.settings.set(MOD, 'permissionsMigrated', true);
}

function updateControls() {
  try {
    if (typeof ui.controls?.initialize === 'function') ui.controls.initialize();
    else ui.controls?.render?.({ reset: true });
  } catch (err) { console.warn(`${MOD} | Cannot refresh controls`, err); }
}


function getBookJournal(book) {
  return game.journal.find(j => j.getFlag(MOD, 'book') === book || (j.getFlag(MOD, 'bookRoot') && j.getFlag(MOD, 'bookType') === book)) ?? null;
}

async function ensureBookJournal(book) {
  let journal = getBookJournal(book);
  if (journal || !game.user.isGM) return journal;
  journal = await JournalEntry.create({
    name: BOOKS[book],
    ownership: ownershipFor(book),
    flags: { [MOD]: { bookRoot: true, bookType: book, book } }
  });
  return journal;
}

function getPosters(book = S.book) {
  if (!canSeeBook(book)) return [];
  const journal = getBookJournal(book);
  if (!journal) return [];
  if (!game.user.isGM && !journal.testUserPermission(game.user, 'OBSERVER')) return [];
  return journal.pages.contents.filter(p => game.user.isGM || p.testUserPermission(game.user, 'OBSERVER')).sort((a, b) => a.sort - b.sort);
}

async function syncOwnership() {
  if (!game.user.isGM) return;
  for (const book of Object.keys(BOOKS)) {
    const journal = getBookJournal(book);
    if (!journal) continue;
    const changes = {};
    // Permission settings are authoritative, even if the old journal had public access.
    if ((journal.ownership?.default ?? 0) !== 0) changes['ownership.default'] = 0;
    for (const u of game.users) {
      if (u.isGM) continue;
      const permitted = !!permissions()[book]?.[u.id];
      if (permitted && journal.ownership?.[u.id] !== 2) changes[`ownership.${u.id}`] = 2;
      if (!permitted && journal.ownership?.[u.id] !== undefined) changes[`ownership.-=${u.id}`] = null;
    }
    if (Object.keys(changes).length) await journal.update(changes);
  }
}

function getSelectedPage() {
  return getBookJournal(S.book)?.pages.get(S.selected) ?? null;
}

function actorOptions(selectedUuid) {
  const rows = [`<option value="">— None —</option>`];
  const actors = game.actors.contents.slice().sort((a, b) => a.name.localeCompare(b.name));
  for (const a of actors) rows.push(`<option value="${esc(a.uuid)}"${a.uuid === selectedUuid ? ' selected' : ''}>${esc(a.name)}</option>`);
  return rows.join('');
}

function posterThumb(page) {
  const uuid = page.getFlag(MOD, 'uuid') ?? '';
  const actor = uuid ? fromUuidSync(uuid) : null;
  const img = page.getFlag(MOD, 'image') || (page.type === 'image' ? page.src : '') || actor?.img || 'icons/svg/mystery-man.svg';
  return img;
}

function previewHTML(page, includeNotes = true) {
  const uuid = page?.getFlag(MOD, 'uuid') ?? '';
  const actor = uuid ? fromUuidSync(uuid) : null;
  const image = page ? posterThumb(page) : 'icons/svg/mystery-man.svg';
  const rawStatus = page?.getFlag(MOD, 'status') ?? 'None';
  const status = ({ active: 'Wanted', claimed: 'Captured', lost: 'Missing', dropped: 'Cleared' })[rawStatus] || rawStatus;
  const rank = rankFor(page?.getFlag(MOD, 'rank'));
  const bg = page?.getFlag(MOD, 'background') ?? 'parchment';
  const notes = page?.getFlag(MOD, 'notes') ?? '';

  return `
    <div class="bb-preview-wrap">
      <div class="bb-poster-card bg-${esc(bg)}" data-status="${esc(status)}">
        <div class="bb-poster-inner">
          <div class="bb-rank-badge rank-${esc(rank)}">Rank ${esc(rank)}</div>
          <img class="bb-poster-image" src="${esc(imgSrc(image))}" alt="">
          ${status && status !== 'None' ? `<div class="bb-stamp stamp-${esc(status.toLowerCase())}">${esc(status)}</div>` : ''}
        </div>
      </div>
      ${includeNotes && notes ? `<div class="bb-preview-notes">${esc(notes)}</div>` : ''}
    </div>`;
}


// Rank categories are simple filters on existing Journal pages.
function rankCategoriesHTML(allPosters) {
  const counts = Object.fromEntries(RANKS.map(rank => [rank, 0]));
  for (const page of allPosters) counts[rankFor(page.getFlag(MOD, 'rank'))]++;
  const choices = [['all', 'All Ranks', allPosters.length], ...RANKS.map(rank => [rank, `Rank ${rank}`, counts[rank]])];
  return `<nav class="bb-rank-categories" aria-label="Poster rank categories">
    ${choices.map(([rank, label, count]) => `<button type="button" class="bb-rank-filter${S.rankFilter === rank ? ' active' : ''}"
      data-act="select-rank" data-rank="${rank}" aria-pressed="${S.rankFilter === rank}">
      <span>${esc(label)}</span><span class="bb-rank-count">${count}</span></button>`).join('')}
  </nav>`;
}

// Non-GMs only see the book's navigation and image. No editor metadata.
function playerViewHTML(page) {
  if (!page) return `<section class="bb-player-stage">${emptyState(false)}</section>`;
  return `<section class="bb-player-stage" aria-label="Poster preview">
    <div class="bb-player-preview">${previewHTML(page, false)}</div>
    <strong class="bb-player-title">${esc(page.name)}</strong>
  </section>`;
}

function accessHTML() {
  const allowed = permissions();
  const users = game.users.filter(u => !u.isGM);
  return `<section class="bb-editor bb-access">
    <h3>Player access</h3>
    <p>Each book has its own browsing permissions. Changes apply to the selected book only.</p>
    <div class="bb-permission-table" role="table" aria-label="Book access">
      <div class="bb-permission-row bb-permission-header" role="row">
        <span>Player</span><span>Bingo Book</span><span>Target Book</span>
      </div>
      ${users.map(u => `<div class="bb-permission-row" role="row">
        <span>${esc(u.name)}</span>
        ${Object.keys(BOOKS).map(book => `<label class="bb-permission-cell" title="${esc(BOOKS[book])} - ${esc(u.name)}">
          <input type="checkbox" aria-label="${esc(BOOKS[book])}: ${esc(u.name)}" data-permission-book="${book}" data-user="${esc(u.id)}" ${allowed[book]?.[u.id] ? 'checked' : ''}>
        </label>`).join('')}
      </div>`).join('') || '<p>No players in this world.</p>'}
    </div>
    <p class="bb-access-note">These settings control browsing. <b>Show in Chat</b> can reveal an individual poster to chosen players without giving them access to the book.</p>
  </section>`;
}

function chatShareHTML() {
  const users = game.users.filter(u => !u.isGM);
  return `<div class="bb-chat-share">
    <div class="bb-share-title"><i class="fa-solid fa-comments"></i> Share poster in chat</div>
    <label class="bb-audience"><input type="radio" name="bb-chat-audience" value="everyone" ${S.chatAudience === 'everyone' ? 'checked' : ''}> Everyone (public chat)</label>
    <label class="bb-audience"><input type="radio" name="bb-chat-audience" value="selected" ${S.chatAudience === 'selected' ? 'checked' : ''}> Selected players (private whisper)</label>
    ${S.chatAudience === 'selected' ? `<div class="bb-chat-users">
      ${users.map(u => `<label><input type="checkbox" data-chat-recipient="${esc(u.id)}" ${S.chatRecipients.includes(u.id) ? 'checked' : ''}> ${esc(u.name)}</label>`).join('') || '<div>No players in the world.</div>'}
    </div>` : ''}
    <div class="bb-chat-actions">
      <button type="button" data-act="send-chat"><i class="fa-solid fa-paper-plane"></i> Send to Chat</button>
      <button type="button" data-act="cancel-chat">Cancel</button>
    </div>
  </div>`;
}

// The same rendered poster is used for browsing and the chat message. The chat
// message contains only escaped text and the image path; no document permissions
// or edit controls are embedded in the message.
function chatPosterHTML(page, book) {
  const image = posterThumb(page);
  const rawStatus = page.getFlag(MOD, 'status') ?? 'None';
  const status = ({ active: 'Wanted', claimed: 'Captured', lost: 'Missing', dropped: 'Cleared' })[rawStatus] || rawStatus;
  const rank = rankFor(page.getFlag(MOD, 'rank'));
  const background = page.getFlag(MOD, 'background') ?? 'parchment';
  const bg = Object.prototype.hasOwnProperty.call(BACKGROUNDS, background) ? background : 'parchment';
  return `<div class="bb-chat-poster">
    <div class="bb-chat-heading">${esc(BOOKS[book])}</div>
    <div class="bb-poster-card bg-${bg}">
      <div class="bb-poster-inner">
        <img class="bb-poster-image" src="${esc(imgSrc(image))}" alt="${esc(page.name)}">
        <div class="bb-rank-badge rank-${rank}">Rank ${rank}</div>
        ${status !== 'None' ? `<div class="bb-stamp stamp-${esc(status.toLowerCase())}">${esc(status)}</div>` : ''}
      </div>
    </div>
    <div class="bb-chat-poster-name">${esc(page.name)}</div>
  </div>`;
}

async function sendPosterToChat(page, book) {
  if (!game.user.isGM || !page || !BOOKS[book]) return;
  let whisper;
  if (S.chatAudience === 'selected') {
    const recipients = game.users.filter(u => !u.isGM && S.chatRecipients.includes(u.id));
    if (!recipients.length) {
      ui.notifications.warn('Select at least one player before sending a private poster.');
      return;
    }
    // Always include all GMs, so the sender can see the message in chat.
    whisper = [...new Set([...recipients.map(u => u.id), ...game.users.filter(u => u.isGM).map(u => u.id)])];
  }
  const msg = {
    user: game.user.id,
    content: chatPosterHTML(page, book),
    speaker: ChatMessage.getSpeaker({ alias: BOOKS[book] })
  };
  if (whisper) msg.whisper = whisper;
  await ChatMessage.create(msg);
  S.chatOpen = false;
  refresh();
}

function emptyState(gm) {
  return `<div class="bb-empty">${gm ? 'No posters yet. Use + Add poster.' : 'No posters in this book yet.'}</div>`;
}

function formHTML(page, gm) {
  if (!page) return `<section class="bb-editor">${emptyState(gm)}</section>`;
  const uuid = page.getFlag(MOD, 'uuid') ?? '';
  const image = page.getFlag(MOD, 'image') ?? '';
  const rawStatus = page.getFlag(MOD, 'status') ?? 'None';
  const status = ({ active: 'Wanted', claimed: 'Captured', lost: 'Missing', dropped: 'Cleared' })[rawStatus] || rawStatus;
  const rank = rankFor(page.getFlag(MOD, 'rank'));
  const background = page.getFlag(MOD, 'background') ?? 'parchment';
  const notes = page.getFlag(MOD, 'notes') ?? '';

  return `
    <section class="bb-editor">
      <div class="bb-editor-grid">
        <div class="bb-left-form">
          <div class="bb-section">
            <label>Title</label>
            ${gm ? `<input type="text" data-field="name" value="${esc(page.name)}">` : `<div class="bb-readonly">${esc(page.name)}</div>`}
          </div>
          <div class="bb-section">
            <label>Actor</label>
            ${gm ? `<select data-field="uuid">${actorOptions(uuid)}</select>` : `<div class="bb-readonly">${esc((uuid && fromUuidSync(uuid)?.name) || '— None —')}</div>`}
          </div>
          <div class="bb-section">
            <label>Art</label>
            <div class="bb-art-row">
              <input type="text" value="${esc(image)}" readonly>
              ${gm ? `<button type="button" data-act="clear-image" title="Clear image"><i class="fa-solid fa-trash"></i></button>` : ''}
            </div>
            ${gm ? `<div class="bb-btn-row">
              <button type="button" data-act="pick-image"><i class="fa-solid fa-image"></i> Add art</button>
              <button type="button" data-act="use-portrait"><i class="fa-solid fa-user"></i> Use portrait</button>
            </div>` : ''}
          </div>
          <div class="bb-section">
            <h3>Style</h3>
            <label>Status</label>
            ${gm ? `<select data-field="status">${STATUSES.map(s => `<option value="${esc(s)}"${s === status ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select>` : `<div class="bb-readonly">${esc(status)}</div>`}
            <label>Rank</label>
            ${gm ? `<select data-field="rank">${RANKS.map(s => `<option value="${esc(s)}"${s === rank ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select>` : `<div class="bb-readonly">${esc(rank)}</div>`}
            <label>Background</label>
            ${gm ? `<select data-field="background">${Object.entries(BACKGROUNDS).map(([k,v]) => `<option value="${esc(k)}"${k === background ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select>` : `<div class="bb-readonly">${esc(BACKGROUNDS[background] || background)}</div>`}
          </div>
          <div class="bb-section">
            <label>Notes</label>
            ${gm ? `<textarea rows="5" data-field="notes">${esc(notes)}</textarea>` : `<div class="bb-readonly bb-multiline">${esc(notes || '—')}</div>`}
          </div>
        </div>
        <div class="bb-right-preview">
          <div class="bb-section">
            <h3>Preview</h3>
            ${previewHTML(page)}
            <div class="bb-preview-footer">
              <span class="bb-preview-footer-title">${esc(page.name)}</span>
              ${gm ? `<button type="button" data-act="toggle-chat" class="bb-show-chat"><i class="fa-solid fa-comment-dots"></i> Show in Chat</button>` : ''}
            </div>
            ${gm && S.chatOpen ? chatShareHTML() : ''}
          </div>
        </div>
      </div>
    </section>`;
}

// Keep the position inside both scrollable book panes during a data refresh.
// Replacing root.innerHTML without this reset the Foundry V11 editor to the top
// every time a select field updated a JournalEntryPage flag.
function captureView(root) {
  const active = root.ownerDocument?.activeElement;
  const field = active && root.contains(active) ? active.getAttribute('data-field') : null;
  return {
    editorTop: root.querySelector('.bb-editor')?.scrollTop ?? 0,
    sidebarTop: root.querySelector('.bb-poster-list')?.scrollTop ?? 0,
    recipientsTop: root.querySelector('.bb-chat-users')?.scrollTop ?? 0,
    focusedField: field
  };
}

function restoreView(root, view) {
  if (!view) return;
  const editor = root.querySelector('.bb-editor');
  const sidebar = root.querySelector('.bb-poster-list');
  const recipients = root.querySelector('.bb-chat-users');
  if (editor) editor.scrollTop = view.editorTop;
  if (sidebar) sidebar.scrollTop = view.sidebarTop;
  if (recipients) recipients.scrollTop = view.recipientsTop;
  if (view.focusedField) {
    const field = root.querySelector(`[data-field="${view.focusedField}"]`);
    if (field?.focus) {
      try { field.focus({ preventScroll: true }); } catch (_) { /* not supported */ }
      // Reapply in case the host/browser scrolled a focused dropdown into view.
      if (editor) editor.scrollTop = view.editorTop;
      if (sidebar) sidebar.scrollTop = view.sidebarTop;
    }
  }
}

// Update only the affected preview and the list row after the GM changes a
// dropdown. Avoids destroying the dropdown and scrolling the form to the top.
function updateVisiblePoster(root, page) {
  const preview = root.querySelector('.bb-preview-wrap');
  if (preview) preview.outerHTML = previewHTML(page);
  const activeRow = root.querySelector('.bb-list-item.active');
  if (activeRow) {
    const title = activeRow.querySelector('.bb-li-name');
    if (title) title.textContent = page.name;
    const sub = activeRow.querySelector('.bb-li-sub');
    if (sub) {
      const status = ({ active: 'Wanted', claimed: 'Captured', lost: 'Missing', dropped: 'Cleared' })[page.getFlag(MOD, 'status')] || page.getFlag(MOD, 'status') || 'None';
      sub.textContent = `${status} • Rank ${rankFor(page.getFlag(MOD, 'rank'))}`;
    }
  }
  const footerTitle = root.querySelector('.bb-preview-footer-title');
  if (footerTitle) footerTitle.textContent = page.name;
}

async function draw(root) {
  if (!root?.isConnected) return;
  const nonce = ++renderNonce;
  const gm = game.user.isGM;
  // Players must never switch to or see the title of a restricted book.
  const books = availableBooks();
  if (!books.length) { root.innerHTML = '<div class="bb-empty">You do not have access to either book.</div>'; return; }
  if (!books.includes(S.book)) { S.book = books[0]; S.selected = null; S.chatOpen = false; }
  if (gm) {
    await ensureBookJournal('bingo');
    await ensureBookJournal('target');
  }
  const allPosters = getPosters(S.book);
  const posters = S.rankFilter === 'all' ? allPosters : allPosters.filter(p => rankFor(p.getFlag(MOD, 'rank')) === S.rankFilter);
  if (!posters.some(p => p.id === S.selected)) S.selected = posters[0]?.id ?? null;
  const page = getSelectedPage();

  // Snapshot right before replacing the markup (after any asynchronous book setup).
  const savedView = captureView(root);
  root.innerHTML = `
    <div class="bb-shell">
      <header class="bb-topbar">
        <div class="bb-tabs">
          ${Object.entries(BOOKS).filter(([k]) => books.includes(k)).map(([k, label]) => `<button type="button" class="bb-tab${S.book === k ? ' active' : ''}" data-act="switch-book" data-book="${k}">${esc(label)}</button>`).join('')}
        </div>
      </header>
      <div class="bb-body">
        <aside class="bb-sidebar">
          <div class="bb-sidebar-head">
            <span>${esc(BOOKS[S.book])}</span>
            ${gm ? `<button type="button" data-act="add-poster"><i class="fa-solid fa-plus"></i></button>` : ''}
          </div>
          ${rankCategoriesHTML(allPosters)}
          <div class="bb-poster-list">
            ${posters.length ? posters.map(p => {
              const thumb = posterThumb(p);
              const rawStatus = p.getFlag(MOD, 'status') ?? 'None';
              const status = ({ active: 'Wanted', claimed: 'Captured', lost: 'Missing', dropped: 'Cleared' })[rawStatus] || rawStatus;
              const rank = rankFor(p.getFlag(MOD, 'rank'));
              return `<button type="button" class="bb-list-item${p.id === S.selected ? ' active' : ''}" data-act="select-poster" data-page="${p.id}">
                <img src="${esc(imgSrc(thumb))}" alt="">
                <span class="bb-li-main">
                  <span class="bb-li-name">${esc(p.name)}</span>
                  <span class="bb-li-sub">${esc(status)} • Rank ${esc(rank)}</span>
                </span>
              </button>`;
            }).join('') : emptyState(gm)}
          </div>
          ${gm ? `<div class="bb-sidebar-foot"><button type="button" data-act="toggle-players"><i class="fa-solid fa-users"></i> ${S.showPlayers ? 'Back to posters' : 'Players'}</button>${page && !S.showPlayers ? `<button type="button" data-act="delete-poster" class="danger"><i class="fa-solid fa-trash"></i> Delete poster</button>` : ''}</div>` : ''}
        </aside>
        ${gm ? (S.showPlayers ? accessHTML() : formHTML(page, true)) : playerViewHTML(page)}
      </div>
    </div>`;

  if (nonce !== renderNonce) return;
  restoreView(root, savedView);
}

function refresh() {
  if (win?.rendered && win.rootEl?.isConnected) draw(win.rootEl);
}
const refreshSoon = foundry.utils.debounce(refresh, 50);

function mount(root, app) {
  app.rootEl = root;

  const currentPage = () => getSelectedPage();

  root.addEventListener('click', async ev => {
    const el = ev.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    const gm = game.user.isGM;

    if (act === 'switch-book') {
      if (!canSeeBook(el.dataset.book)) return;
      S.book = el.dataset.book;
      S.rankFilter = 'all';
      S.selected = null;
      S.showPlayers = false;
      S.chatOpen = false;
      refresh();
      return;
    }
    if (act === 'select-rank') {
      const rank = el.dataset.rank;
      if (rank !== 'all' && !RANKS.includes(rank)) return;
      S.rankFilter = rank;
      S.selected = null;
      S.chatOpen = false;
      refresh();
      return;
    }
    if (act === 'select-poster') {
      const matching = getPosters(S.book).some(p => p.id === el.dataset.page &&
        (S.rankFilter === 'all' || rankFor(p.getFlag(MOD, 'rank')) === S.rankFilter));
      if (!matching) return;
      S.selected = el.dataset.page;
      S.chatOpen = false;
      refresh();
      return;
    }
    if (!gm) return;

    switch (act) {
      case 'toggle-chat': S.chatOpen = !S.chatOpen; refresh(); break;
      case 'cancel-chat': S.chatOpen = false; refresh(); break;
      case 'send-chat': await sendPosterToChat(currentPage(), S.book); break;
      case 'toggle-players': S.showPlayers = !S.showPlayers; refresh(); break;
      case 'add-poster': {
        const journal = await ensureBookJournal(S.book);
        const created = await journal.createEmbeddedDocuments('JournalEntryPage', [{
          name: 'New Poster',
          type: 'text',
          text: { content: '', format: 1 },
          flags: { [MOD]: { image: '', status: 'None', rank: S.rankFilter === 'all' ? 'D' : S.rankFilter, background: 'parchment', uuid: '', notes: '' } }
        }]);
        S.selected = created?.[0]?.id ?? null;
        refresh();
        break;
      }
      case 'delete-poster': {
        const page = currentPage();
        if (!page) return;
        const ok = await confirmDialog('Delete poster', `Delete <strong>${esc(page.name)}</strong>?`);
        if (ok) {
          await page.delete();
          S.selected = null;
        }
        break;
      }
      case 'pick-image': {
        const page = currentPage();
        if (!page) return;
        new FilePicker({ type: 'image', callback: path => page.setFlag(MOD, 'image', path) }).browse();
        break;
      }
      case 'clear-image': {
        await currentPage()?.setFlag(MOD, 'image', '');
        break;
      }
      case 'use-portrait': {
        const page = currentPage();
        if (!page) return;
        const uuid = page.getFlag(MOD, 'uuid');
        const actor = uuid ? fromUuidSync(uuid) : null;
        if (!actor?.img) return ui.notifications.warn('Select an actor first.');
        await page.setFlag(MOD, 'image', actor.img);
        break;
      }
    }
  });

  root.addEventListener('change', async ev => {
    if (!game.user.isGM) return;
    const permissionBox = ev.target.closest('[data-permission-book][data-user]');
    if (permissionBox) {
      const book = permissionBox.dataset.permissionBook;
      if (!BOOKS[book] || !game.users.get(permissionBox.dataset.user) || game.users.get(permissionBox.dataset.user).isGM) return;
      const next = foundry.utils.deepClone(permissions());
      next[book] ||= {};
      next[book][permissionBox.dataset.user] = permissionBox.checked;
      await game.settings.set(MOD, 'bookPermissions', next);
      await syncOwnership();
      updateControls();
      return;
    }
    const audienceBox = ev.target.closest('input[name="bb-chat-audience"]');
    if (audienceBox) { S.chatAudience = audienceBox.value; refresh(); return; }
    const recipientBox = ev.target.closest('[data-chat-recipient]');
    if (recipientBox) {
      const id = recipientBox.dataset.chatRecipient;
      S.chatRecipients = recipientBox.checked ? [...new Set([...S.chatRecipients, id])] : S.chatRecipients.filter(userId => userId !== id);
      return;
    }
    const field = ev.target.closest('[data-field]');
    if (!field) return;
    const page = currentPage();
    if (!page) return;
    const value = field.value;
    const id = page.uuid || page.id;
    const view = captureView(root);
    localPageUpdates.add(id);
    try {
      switch (field.dataset.field) {
        case 'name': await page.update({ name: value.trim() || 'New Poster' }); break;
        case 'uuid': await page.setFlag(MOD, 'uuid', value); break;
        case 'status': await page.setFlag(MOD, 'status', value); break;
        case 'rank': await page.setFlag(MOD, 'rank', value); break;
        case 'background': await page.setFlag(MOD, 'background', value); break;
        case 'notes': await page.setFlag(MOD, 'notes', value); break;
        default: return;
      }
      // A user may select another poster while the save is in-flight.
      if (currentPage()?.id === page.id) {
        if (field.dataset.field === 'rank' && S.rankFilter !== 'all' && rankFor(value) !== S.rankFilter) {
          S.selected = null;
          refresh();
        } else {
          updateVisiblePoster(root, page);
          const nav = root.querySelector('.bb-rank-categories');
          if (nav) nav.outerHTML = rankCategoriesHTML(getPosters(S.book));
          restoreView(root, view);
        }
      }
    } catch (error) {
      console.error(`${MOD} | Failed to save poster`, error);
      ui.notifications.error('Bingo Book: could not save this change.');
      refresh();
    } finally {
      localPageUpdates.delete(id);
    }
  });

  root.addEventListener('input', ev => {
    const field = ev.target.closest('textarea[data-field="notes"], input[data-field="name"]');
    if (!field || !game.user.isGM) return;
    if (field.dataset.field === 'name') {
      const title = root.querySelector('.bb-preview-footer-title');
      if (title) title.textContent = field.value || 'New Poster';
    }
  });

  draw(root);
}

class BingoBookApp extends Application {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: MOD,
      classes: ['bingo-book'],
      template: `modules/${MOD}/templates/book.hbs`,
      title: 'Bingo Book',
      width: game.user.isGM ? 1080 : 750,
      height: game.user.isGM ? 760 : 590,
      resizable: true
    });
  }

  activateListeners(html) {
    super.activateListeners(html);
    const el = html[0];
    mount(el.matches('.bb-root') ? el : el.querySelector('.bb-root'), this);
  }
}

function openBook() {
  if (!canSee()) return ui.notifications.warn('Neither book is available to you.');
  if (win?.rendered) { refresh(); return win.bringToTop(); }
  win = new BingoBookApp();
  renderApp(win);
}

Hooks.once('init', () => {
  game.settings.register(MOD, 'allowedUsers', { scope: 'world', config: false, type: Object, default: {} }); // legacy migration only
  game.settings.register(MOD, 'permissionsMigrated', { scope: 'world', config: false, type: Boolean, default: false });
  game.settings.register(MOD, 'bookPermissions', {
    scope: 'world', config: false, type: Object, default: { bingo: {}, target: {} },
    onChange: () => { updateControls(); if (!canSee() && win?.rendered) win.close(); else refresh(); }
  });
});

Hooks.once('ready', async () => {
  if (game.user.isGM) {
    await migratePermissions();
    await ensureBookJournal('bingo');
    await ensureBookJournal('target');
    await syncOwnership();
  }
  game.modules.get(MOD).api = { open: openBook, openBingo: () => { S.book = 'bingo'; openBook(); refresh(); }, openTarget: () => { S.book = 'target'; openBook(); refresh(); } };
});

Hooks.on('getSceneControlButtons', controls => {
  const tool = {
    name: MOD,
    title: 'Bingo Book',
    icon: 'fa-solid fa-book',
    button: true,
    visible: canSee(),
    onClick: () => openBook(),
    onChange: () => openBook()
  };
  const group = controls.find(c => c.name === 'token');
  group?.tools.push(tool);
});

for (const hook of ['createJournalEntryPage', 'deleteJournalEntryPage']) {
  Hooks.on(hook, () => refreshSoon());
}
Hooks.on('updateJournalEntryPage', page => {
  // The editing client already updates its own preview without rebuilding the form.
  if (localPageUpdates.has(page.uuid || page.id)) return;
  refreshSoon();
});

Hooks.on('updateJournalEntry', journal => {
  if (journal.getFlag(MOD, 'bookRoot') || journal.getFlag(MOD, 'book')) refreshSoon();
});

Hooks.on('renderJournalDirectory', (app, html) => {
  if (game.user.isGM) return;
  const root = html?.[0] ?? html;
  if (!root) return;
  for (const journal of game.journal) {
    if (!journal.getFlag(MOD, 'bookRoot') && !journal.getFlag(MOD, 'book')) continue;
    root.querySelectorAll(`[data-document-id="${journal.id}"], [data-entry-id="${journal.id}"]`).forEach(e => e.remove());
  }
});
