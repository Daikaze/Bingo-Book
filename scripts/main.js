const MOD = 'bingo-book';
const BOOKS = {
  bingo: 'Bingo Book',
  target: 'Target Book'
};
const STATUSES = ['None', 'Wanted', 'Dead', 'Captured', 'Missing', 'Cleared'];
const RANKS = ['S', 'A', 'B', 'C', 'D'];
const BACKGROUNDS = {
  parchment: 'Parchment',
  page: 'Book Page',
  dark: 'Dark Page',
  clean: 'Clean Frame'
};

const S = {
  book: 'bingo',
  selected: null,
  showPlayers: false
};
let win = null;
let renderNonce = 0;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const imgSrc = path => path ? (/^(https?:|data:|blob:)/i.test(path) ? path : foundry.utils.getRoute(path)) : '';

function renderApp(app) {
  if (!app) return;
  return app.render(true);
}

async function confirmDialog(title, content) {
  return Dialog.confirm({ title, content: `<p>${content}</p>` });
}

function allowedUsers() { return game.settings.get(MOD, 'allowedUsers') || {}; }
function canSee(user = game.user) { return user.isGM || !!allowedUsers()[user.id]; }

function allPlayersOwnership() {
  const ownership = { default: 0 };
  for (const u of game.users) if (!u.isGM && allowedUsers()[u.id]) ownership[u.id] = 2;
  return ownership;
}

function getBookJournal(book) {
  return game.journal.find(j => j.getFlag(MOD, 'book') === book || (j.getFlag(MOD, 'bookRoot') && j.getFlag(MOD, 'bookType') === book)) ?? null;
}

async function ensureBookJournal(book) {
  let journal = getBookJournal(book);
  if (journal || !game.user.isGM) return journal;
  journal = await JournalEntry.create({
    name: BOOKS[book],
    ownership: allPlayersOwnership(),
    flags: { [MOD]: { bookRoot: true, bookType: book, book } }
  });
  return journal;
}

function getPosters(book = S.book) {
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
    for (const u of game.users) {
      if (u.isGM) continue;
      if (allowedUsers()[u.id] && journal.ownership?.[u.id] !== 2) changes[`ownership.${u.id}`] = 2;
      if (!allowedUsers()[u.id] && journal.ownership?.[u.id] !== undefined) changes[`ownership.-=${u.id}`] = null;
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
  const img = page.getFlag(MOD, 'image') || actor?.img || 'icons/svg/mystery-man.svg';
  return img;
}

function previewHTML(page) {
  const uuid = page?.getFlag(MOD, 'uuid') ?? '';
  const actor = uuid ? fromUuidSync(uuid) : null;
  const image = page ? (page.getFlag(MOD, 'image') || actor?.img || 'icons/svg/mystery-man.svg') : 'icons/svg/mystery-man.svg';
  const rawStatus = page?.getFlag(MOD, 'status') ?? 'None';
  const status = ({ active: 'Wanted', claimed: 'Captured', lost: 'Missing', dropped: 'Cleared' })[rawStatus] || rawStatus;
  const rank = page?.getFlag(MOD, 'rank') ?? 'D';
  const bg = page?.getFlag(MOD, 'background') ?? 'parchment';
  const notes = page?.getFlag(MOD, 'notes') ?? '';
  const title = page?.name ?? 'New Poster';

  return `
    <div class="bb-preview-wrap">
      <div class="bb-poster-card bg-${esc(bg)}" data-status="${esc(status)}">
        <div class="bb-poster-inner">
          <div class="bb-rank-badge rank-${esc(rank)}">Rank ${esc(rank)}</div>
          <img class="bb-poster-image" src="${esc(imgSrc(image))}" alt="">
          ${status && status !== 'None' ? `<div class="bb-stamp stamp-${esc(status.toLowerCase())}">${esc(status)}</div>` : ''}
        </div>
      </div>
      <div class="bb-preview-title">${esc(title)}</div>
      ${notes ? `<div class="bb-preview-notes">${esc(notes)}</div>` : ''}
    </div>`;
}

function accessHTML() {
  const allowed = allowedUsers();
  return `<section class="bb-editor bb-access">
    <h3>Player access</h3>
    <p>Choose the players who may view Bingo Book and Target Book.</p>
    ${game.users.filter(u => !u.isGM).map(u => `<label class="bb-user"><input type="checkbox" data-user="${esc(u.id)}" ${allowed[u.id] ? 'checked' : ''}> ${esc(u.name)}</label>`).join('') || '<p>No players in the world.</p>'}
    <p>Only GMs can edit posters, statuses, ranks and backgrounds.</p>
  </section>`;
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
  const rank = page.getFlag(MOD, 'rank') ?? 'D';
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
          </div>
        </div>
      </div>
    </section>`;
}

async function draw(root) {
  if (!root?.isConnected) return;
  const nonce = ++renderNonce;
  await ensureBookJournal('bingo');
  await ensureBookJournal('target');
  const gm = game.user.isGM;
  const posters = getPosters(S.book);
  if (!posters.some(p => p.id === S.selected)) S.selected = posters[0]?.id ?? null;
  const page = getSelectedPage();

  root.innerHTML = `
    <div class="bb-shell">
      <header class="bb-topbar">
        <div class="bb-tabs">
          ${Object.entries(BOOKS).map(([k, label]) => `<button type="button" class="bb-tab${S.book === k ? ' active' : ''}" data-act="switch-book" data-book="${k}">${esc(label)}</button>`).join('')}
        </div>
      </header>
      <div class="bb-body">
        <aside class="bb-sidebar">
          <div class="bb-sidebar-head">
            <span>${esc(BOOKS[S.book])}</span>
            ${gm ? `<button type="button" data-act="add-poster"><i class="fa-solid fa-plus"></i></button>` : ''}
          </div>
          <div class="bb-poster-list">
            ${posters.length ? posters.map(p => {
              const thumb = posterThumb(p);
              const rawStatus = p.getFlag(MOD, 'status') ?? 'None';
              const status = ({ active: 'Wanted', claimed: 'Captured', lost: 'Missing', dropped: 'Cleared' })[rawStatus] || rawStatus;
              const rank = p.getFlag(MOD, 'rank') ?? 'D';
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
        ${S.showPlayers && gm ? accessHTML() : formHTML(page, gm)}
      </div>
    </div>`;

  if (nonce !== renderNonce) return;
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
      S.book = el.dataset.book || 'bingo';
      S.selected = null;
      S.showPlayers = false;
      refresh();
      return;
    }
    if (act === 'select-poster') {
      S.selected = el.dataset.page;
      refresh();
      return;
    }
    if (!gm) return;

    switch (act) {
      case 'toggle-players': S.showPlayers = !S.showPlayers; refresh(); break;
      case 'add-poster': {
        const journal = await ensureBookJournal(S.book);
        const created = await journal.createEmbeddedDocuments('JournalEntryPage', [{
          name: 'New Poster',
          type: 'text',
          text: { content: '', format: 1 },
          flags: { [MOD]: { image: '', status: 'None', rank: 'D', background: 'parchment', uuid: '', notes: '' } }
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
    const userBox = ev.target.closest('[data-user]');
    if (userBox) {
      await game.settings.set(MOD, 'allowedUsers', { ...allowedUsers(), [userBox.dataset.user]: userBox.checked });
      await syncOwnership();
      return;
    }
    const field = ev.target.closest('[data-field]');
    if (!field) return;
    const page = currentPage();
    if (!page) return;
    const value = field.value;
    switch (field.dataset.field) {
      case 'name': await page.update({ name: value.trim() || 'New Poster' }); break;
      case 'uuid': await page.setFlag(MOD, 'uuid', value); break;
      case 'status': await page.setFlag(MOD, 'status', value); break;
      case 'rank': await page.setFlag(MOD, 'rank', value); break;
      case 'background': await page.setFlag(MOD, 'background', value); break;
      case 'notes': await page.setFlag(MOD, 'notes', value); break;
    }
  });

  root.addEventListener('input', ev => {
    const field = ev.target.closest('textarea[data-field="notes"], input[data-field="name"]');
    if (!field || !game.user.isGM) return;
    if (field.dataset.field === 'name') {
      const title = root.querySelector('.bb-preview-title');
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
      width: 1080,
      height: 760,
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
  if (!canSee()) return ui.notifications.warn('Bingo Book is not available to you.');
  if (win?.rendered) return win.bringToTop();
  win = new BingoBookApp();
  renderApp(win);
}

Hooks.once('init', () => {
  game.settings.register(MOD, 'allowedUsers', { scope: 'world', config: false, type: Object, default: {} });
});

Hooks.once('ready', async () => {
  if (game.user.isGM) {
    await ensureBookJournal('bingo');
    await ensureBookJournal('target');
    await syncOwnership();
  }
  game.modules.get(MOD).api = { open: openBook };
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

for (const hook of ['createJournalEntryPage', 'updateJournalEntryPage', 'deleteJournalEntryPage']) {
  Hooks.on(hook, () => refreshSoon());
}

Hooks.on('updateJournalEntry', journal => {
  if (journal.getFlag(MOD, 'bookRoot')) refreshSoon();
});

Hooks.on('renderJournalDirectory', (app, html) => {
  if (game.user.isGM) return;
  const root = html?.[0] ?? html;
  if (!root) return;
  for (const journal of game.journal) {
    if (!journal.getFlag(MOD, 'bookRoot')) continue;
    root.querySelectorAll(`[data-document-id="${journal.id}"], [data-entry-id="${journal.id}"]`).forEach(e => e.remove());
  }
});
