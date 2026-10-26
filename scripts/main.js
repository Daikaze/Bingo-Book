/**
 * Bingo Book & Target Book — Foundry VTT v11, v0.2.1.
 * Each entry contains an entire, user-supplied poster IMAGE, not generated poster components.
 * Traditional parchment/book visual style restored from the original v0.1.0 module.
 * Existing v0.2.0 journals and older v0.1.0 category pages remain intact.
 */
const MOD = "bingo-book";
const BOOKS = {
  bingo: { label: "Bingo Book", icon: "fa-solid fa-book-open", storage: "Bingo Book (Storage)" },
  target: { label: "Target Book", icon: "fa-solid fa-crosshairs", storage: "Target Book (Storage)" }
};
const STATUSES = { active: "Wanted", claimed: "Claimed", lost: "Lost", dropped: "Dropped" };
const generation = () => Number(game.release?.generation ?? parseInt(game.version, 10) ?? 11);
const USE_V2 = generation() >= 13 && !!foundry.applications?.api?.ApplicationV2;
const FP = () => (USE_V2 && foundry.applications?.apps?.FilePicker?.implementation) || FilePicker;
const escapeHTML = text => String(text ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const imageURL = path => !path ? "" : /^(https?:|data:|blob:|\/)/i.test(path) ? path : (foundry.utils.getRoute?.(path) || path);
const allowedUsers = () => game.settings.get(MOD, "allowedUsers") || {};
const canSee = (user = game.user) => user.isGM || !!allowedUsers()[user.id];
const getBook = book => game.journal.find(doc => doc.getFlag(MOD, "book") === book) || null;
const getEntries = book => {
  const journal = getBook(book);
  if (!journal || (!game.user.isGM && !journal.testUserPermission(game.user, "OBSERVER"))) return [];
  return journal.pages.contents.filter(p => game.user.isGM || p.testUserPermission(game.user, "OBSERVER"))
    .sort((a, b) => (a.sort || 0) - (b.sort || 0));
};

function ownershipFor() {
  const ownership = { default: 0 };
  for (const user of game.users) if (!user.isGM && allowedUsers()[user.id]) ownership[user.id] = 2;
  return ownership;
}
async function syncOwnership() {
  if (!game.user.isGM) return;
  for (const journal of game.journal) {
    if (!journal.getFlag(MOD, "book")) continue;
    const changes = {};
    for (const user of game.users) {
      if (user.isGM) continue;
      if (allowedUsers()[user.id] && journal.ownership?.[user.id] !== 2) changes[`ownership.${user.id}`] = 2;
      if (!allowedUsers()[user.id] && journal.ownership?.[user.id] !== undefined) changes[`ownership.-=${user.id}`] = null;
    }
    if (Object.keys(changes).length) await journal.update(changes);
  }
}
async function ensureBooks() {
  if (!game.user.isGM) return;
  for (const [id, data] of Object.entries(BOOKS)) {
    if (getBook(id)) continue;
    await JournalEntry.create({ name: data.storage, ownership: ownershipFor(), flags: { [MOD]: { book: id } } });
  }
}
// Copy pages of original v0.1 category journals ONLY ONCE; never delete or overwrite originals.
async function migrateOldCategories() {
  if (!game.user.isGM) return;
  const destination = getBook("bingo");
  if (!destination) return;
  for (const old of game.journal.filter(doc => doc.getFlag(MOD, "category"))) {
    for (const page of old.pages.contents) {
      const source = page.uuid || `${old.uuid}.JournalEntryPage.${page.id}`;
      if (destination.pages.contents.some(p => p.getFlag(MOD, "legacySource") === source)) continue;
      const data = page.toObject();
      delete data._id;
      delete data._stats;
      data.flags = foundry.utils.deepClone(data.flags || {});
      data.flags[MOD] = { ...(data.flags[MOD] || {}), legacySource: source };
      await destination.createEmbeddedDocuments("JournalEntryPage", [data]);
    }
    const removeAccess = {};
    if (old.ownership?.default !== 0) removeAccess["ownership.default"] = 0;
    for (const user of game.users) if (!user.isGM && old.ownership?.[user.id] !== undefined) removeAccess[`ownership.-=${user.id}`] = null;
    if (Object.keys(removeAccess).length) await old.update(removeAccess);
  }
}

// Backward-compatible fallback for users who assigned their uploaded art as a v0.2.0 template.
// Never alter old template settings or journal flags. The chosen template is used only if
// the entry lacks its own image. This preserves previously configured poster images.
function posterImage(page, book) {
  const direct = page.getFlag(MOD, "image") || (page.type === "image" ? page.src : "");
  if (direct) return direct;
  const selected = page.getFlag(MOD, "templateId");
  const all = game.settings.get(MOD, "templates") || {};
  return (Array.isArray(all[book]) ? all[book] : []).find(t => t.id === selected)?.image || "";
}

const state = { book: "bingo", showPlayers: false };
let windowInstance = null;
let renderSequence = 0;
function renderApp(app) {
  if (!app) return;
  return (USE_V2 && app instanceof foundry.applications.api.ApplicationV2) ? app.render({ force: true }) : app.render(true);
}
async function confirmAction(title, content) {
  if (USE_V2 && foundry.applications?.api?.DialogV2?.confirm)
    return foundry.applications.api.DialogV2.confirm({ window: { title }, content: `<p>${content}</p>`, rejectClose: false });
  return Dialog.confirm({ title, content: `<p>${content}</p>` });
}
function refresh() {
  if (windowInstance?.rendered && windowInstance.rootEl?.isConnected) draw(windowInstance.rootEl);
}
const refreshSoon = foundry.utils.debounce(refresh, 70);
function refreshControls() {
  try {
    if (typeof ui.controls?.initialize === "function") ui.controls.initialize();
    else ui.controls?.render({ reset: true });
  } catch (e) { console.warn(`${MOD} | Unable to refresh scene controls`, e); }
}
function picker(current, callback) {
  try {
    const browser = new (FP())({ type: "image", current: current || "", callback: async path => {
      try { if (path) await callback(path); } catch (error) {
        console.error(`${MOD} | Could not save selected image`, error);
        ui.notifications.error("Bingo Book: image could not be saved.");
      }
    }});
    Promise.resolve(browser.browse()).catch(error => {
      console.error(`${MOD} | File picker error`, error);
      ui.notifications.error("Bingo Book: could not open the image picker.");
    });
  } catch (error) {
    console.error(`${MOD} | File picker error`, error);
    ui.notifications.error("Bingo Book: could not open the image picker.");
  }
}
function posterNameFromPath(path) {
  let name = String(path).split("/").pop().split("?")[0];
  try { name = decodeURIComponent(name); } catch (_error) { /* ignore invalid percent-encoding */ }
  return (name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "Wanted Poster").slice(0, 120);
}
async function addPoster(book, path) {
  if (!game.user.isGM || !BOOKS[book] || !path) return;
  let journal = getBook(book);
  if (!journal) { await ensureBooks(); journal = getBook(book); }
  if (!journal) throw new Error("Book storage was not created.");
  return journal.createEmbeddedDocuments("JournalEntryPage", [{
    name: posterNameFromPath(path), type: "text", text: { content: "", format: 1 },
    flags: { [MOD]: { image: path, status: "active", uuid: "" } }
  }]);
}
function linkedDocument(uuid) {
  if (!uuid) return null;
  try { return fromUuidSync(uuid) || null; } catch (_error) { return null; }
}
async function openLinked(uuid) {
  const document = uuid ? await fromUuid(uuid) : null;
  if (!document?.sheet) return;
  if (!game.user.isGM && !document.testUserPermission?.(game.user, "LIMITED")) {
    ui.notifications.warn("You don't have permission to open that document."); return;
  }
  renderApp(document.sheet);
}

function posterHTML(page, gm, book) {
  const path = posterImage(page, book);
  const status = page.getFlag(MOD, "status") || "active";
  const uuid = page.getFlag(MOD, "uuid") || "";
  const linked = linkedDocument(uuid);
  const link = linked ? `<div class="bb-link"><a data-act="open-link" title="Open linked sheet"><i class="fa-solid fa-link"></i> ${escapeHTML(linked.name)}</a>${gm ? `<button type="button" data-act="clear-link" title="Remove link"><i class="fa-solid fa-xmark"></i></button>` : ""}</div>` : "";
  const options = Object.entries(STATUSES).map(([k, label]) => `<option value="${k}"${status === k ? " selected" : ""}>${book === "target" && k === "active" ? "Targeted" : label}</option>`).join("");
  return `<article class="bb-poster" data-page="${escapeHTML(page.id)}">
    <div class="bb-paper">
      <div class="bb-image"${gm ? ' data-act="replace-image" role="button" tabindex="0" title="Click to replace this poster image"' : ""}>
        ${path ? `<img src="${escapeHTML(imageURL(path))}" alt="${escapeHTML(page.name)}" loading="lazy">` : `<div class="bb-image-empty"><i class="fa-regular fa-image"></i><span>${gm ? "Select poster image" : "Image unavailable"}</span></div>`}
      </div>
      ${gm ? `<input class="bb-poster-title" data-field="name" type="text" value="${escapeHTML(page.name)}" aria-label="Poster name">` : `<div class="bb-poster-title">${escapeHTML(page.name)}</div>`}
      ${link}
      ${gm && !linked ? `<div class="bb-link bb-hint">Drop an Actor or Item here to link it</div>` : ""}
    </div>
    ${gm ? `<div class="bb-gm">
      <select data-field="status" aria-label="Poster status" title="Poster status">${options}</select>
      <button type="button" data-act="replace-image" title="Replace poster image"><i class="fa-solid fa-image"></i></button>
      <button type="button" data-act="remove-poster" title="Delete poster"><i class="fa-solid fa-trash"></i></button>
    </div>` : status !== "active" ? `<div class="bb-status">${escapeHTML(STATUSES[status] || status)}</div>` : ""}
  </article>`;
}
function playerManagerHTML() {
  const access = allowedUsers();
  const users = game.users.filter(u => !u.isGM);
  return `<div class="bb-players"><h3>Who can see the books?</h3><p>Select players who may view both Bingo Book and Target Book.</p>
    <ul>${users.length ? users.map(u => `<li><label><input type="checkbox" data-user="${escapeHTML(u.id)}"${access[u.id] ? " checked" : ""}> ${escapeHTML(u.name)}</label></li>`).join("") : "<li>No players in this world yet.</li>"}</ul>
    <button type="button" data-act="toggle-players">Done</button></div>`;
}
async function draw(root) {
  if (!root?.isConnected) return;
  ++renderSequence;
  const book = BOOKS[state.book] ? state.book : "bingo";
  const gm = game.user.isGM;
  const pages = getEntries(book);
  const showPlayers = gm && state.showPlayers;
  root.innerHTML = `<div class="bb-layout">
    <nav class="bb-top-tabs" aria-label="Book selection">
      ${Object.entries(BOOKS).map(([id, info]) => `<button type="button" data-act="switch-book" data-book="${id}" class="bb-tab${id === book ? " active" : ""}" aria-selected="${id === book}"><i class="${info.icon}"></i> ${info.label}</button>`).join("")}
    </nav>
    <section class="bb-main">
      <header class="bb-head"><h2>${showPlayers ? "Player Access" : BOOKS[book].label}</h2>
        ${gm ? `<div class="bb-head-actions"><button type="button" data-act="toggle-players"><i class="fa-solid fa-users"></i> ${showPlayers ? "Back to Book" : "Players"}</button>${!showPlayers ? '<button type="button" data-act="add-poster"><i class="fa-solid fa-plus"></i> Add Poster Image</button>' : ""}</div>` : ""}
      </header>
      ${showPlayers ? playerManagerHTML() : `<div class="bb-grid">${pages.length ? pages.map(page => posterHTML(page, gm, book)).join("") : `<p class="bb-empty-state">${gm ? "No posters yet. Click Add Poster Image to import a complete wanted poster." : "No posters available yet."}</p>`}</div>`}
    </section>
  </div>`;
}

function mount(root, app) {
  if (!root) return;
  app.rootEl = root;
  if (root.dataset.bbMounted === "yes") { draw(root); return; }
  root.dataset.bbMounted = "yes";
  const pageFor = element => {
    const id = element.closest("[data-page]")?.dataset.page;
    return id ? getBook(state.book)?.pages.get(id) : null;
  };
  root.addEventListener("click", async event => {
    const link = event.target.closest("a.content-link[data-uuid]");
    if (link) { event.preventDefault(); await openLinked(link.dataset.uuid); return; }
    const button = event.target.closest("[data-act]");
    if (!button) return;
    const act = button.dataset.act;
    if (act === "switch-book") {
      if (!BOOKS[button.dataset.book]) return;
      state.book = button.dataset.book;
      state.showPlayers = false;
      refresh(); return;
    }
    if (act === "open-link") { await openLinked(pageFor(button)?.getFlag(MOD, "uuid")); return; }
    if (!game.user.isGM) return;
    try {
      switch (act) {
        case "toggle-players": state.showPlayers = !state.showPlayers; refresh(); break;
        case "add-poster": {
          const book = state.book;
          picker("", async path => addPoster(book, path));
          break;
        }
        case "replace-image": {
          const page = pageFor(button);
          if (page) picker(posterImage(page, state.book), path => page.setFlag(MOD, "image", path));
          break;
        }
        case "remove-poster": {
          const page = pageFor(button);
          if (page && await confirmAction("Delete Poster", `Delete <strong>${escapeHTML(page.name)}</strong>?`)) await page.delete();
          break;
        }
        case "clear-link": await pageFor(button)?.unsetFlag(MOD, "uuid"); break;
      }
    } catch (error) {
      console.error(`${MOD} | Action failed`, act, error);
      ui.notifications.error("Bingo Book: action failed. Check the console.");
    }
  });
  root.addEventListener("keydown", ev => {
    if ((ev.key === "Enter" || ev.key === " ") && ev.target.matches("[data-act='replace-image']")) {
      ev.preventDefault(); ev.target.click();
    }
  });
  root.addEventListener("change", async event => {
    if (!game.user.isGM) return;
    const target = event.target;
    try {
      if (target.matches("[data-user]")) {
        await game.settings.set(MOD, "allowedUsers", { ...allowedUsers(), [target.dataset.user]: target.checked });
        await syncOwnership(); return;
      }
      if (!target.matches("[data-field]")) return;
      const page = pageFor(target);
      if (!page) return;
      if (target.dataset.field === "name") await page.update({ name: target.value.trim() || "Wanted Poster" });
      if (target.dataset.field === "status" && Object.prototype.hasOwnProperty.call(STATUSES, target.value)) await page.setFlag(MOD, "status", target.value);
    } catch (error) {
      console.error(`${MOD} | Could not save change`, error);
      ui.notifications.error("Bingo Book: could not save this change.");
    }
  });
  root.addEventListener("dragover", event => {
    if (game.user.isGM && event.target.closest(".bb-poster")) event.preventDefault();
  });
  root.addEventListener("drop", async event => {
    if (!game.user.isGM || !event.target.closest(".bb-poster")) return;
    event.preventDefault();
    let drag;
    try { drag = JSON.parse(event.dataTransfer?.getData("text/plain") || "null"); } catch (_error) { return; }
    if (!["Actor", "Item"].includes(drag?.type)) return;
    const uuid = drag.uuid || (drag.id ? `${drag.type}.${drag.id}` : "");
    if (uuid) await pageFor(event.target)?.setFlag(MOD, "uuid", uuid);
  });
  draw(root);
}

let BookWindow;
if (USE_V2) {
  const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
  BookWindow = class BookWindow extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
      id: MOD, classes: ["bingo-book"], position: { width: 980, height: 680 },
      window: { title: "Bingo Book / Target Book", icon: "fa-solid fa-book", resizable: true }
    };
    static PARTS = { main: { template: `modules/${MOD}/templates/book.hbs` } };
    _onRender(context, options) { super._onRender?.(context, options); mount(this.element.querySelector(".bb-root"), this); }
  };
} else {
  BookWindow = class BookWindow extends Application {
    static get defaultOptions() {
      return foundry.utils.mergeObject(super.defaultOptions, {
        id: MOD, classes: ["bingo-book"], template: `modules/${MOD}/templates/book.hbs`,
        title: "Bingo Book / Target Book", width: 980, height: 680, resizable: true
      });
    }
    activateListeners(html) {
      super.activateListeners(html);
      const element = html[0];
      mount(element.matches(".bb-root") ? element : element.querySelector(".bb-root"), this);
    }
  };
}
function openBook(book = null) {
  if (!canSee()) { ui.notifications.warn("You don't have access to these books."); return; }
  if (book && BOOKS[book]) state.book = book;
  state.showPlayers = false;
  if (windowInstance?.rendered) {
    refresh();
    if (USE_V2) windowInstance.bringToFront(); else windowInstance.bringToTop();
    return;
  }
  windowInstance = new BookWindow(); renderApp(windowInstance);
}
Hooks.once("init", () => {
  game.settings.register(MOD, "allowedUsers", {
    scope: "world", config: false, type: Object, default: {},
    onChange: () => {
      refreshControls();
      if (!canSee() && windowInstance?.rendered) windowInstance.close(); else refresh();
    }
  });
  // Preserve older v0.2.0 template settings so existing image paths remain readable.
  game.settings.register(MOD, "templates", {
    scope: "world", config: false, type: Object, default: { bingo: [], target: [] }, onChange: refresh
  });
});
Hooks.once("ready", async () => {
  game.modules.get(MOD).api = { open: openBook, openBingo: () => openBook("bingo"), openTarget: () => openBook("target") };
  if (game.user.isGM) try { await ensureBooks(); await migrateOldCategories(); await syncOwnership(); }
  catch (error) { console.error(`${MOD} | Initialization failed`, error); ui.notifications.error("Bingo Book: cannot initialize books. Check browser console."); }
  refreshSoon();
});
Hooks.on("getSceneControlButtons", controls => {
  const tool = { name: MOD, title: "Bingo Book / Target Book", icon: "fa-solid fa-book", button: true,
    visible: canSee(), onClick: () => openBook(), onChange: () => openBook() };
  if (Array.isArray(controls)) controls.find(c => c.name === "token")?.tools.push(tool);
  else { const group = controls.tokens || controls.token; if (group) { tool.order = Object.keys(group.tools).length; group.tools[MOD] = tool; } }
});
for (const hook of ["createJournalEntry", "updateJournalEntry", "deleteJournalEntry", "createJournalEntryPage", "updateJournalEntryPage", "deleteJournalEntryPage"])
  Hooks.on(hook, () => { if (windowInstance?.rendered) refreshSoon(); });
Hooks.on("renderJournalDirectory", (app, html) => {
  if (game.user.isGM) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root) return;
  for (const journal of game.journal) {
    if (!(journal.getFlag(MOD, "book") || journal.getFlag(MOD, "category"))) continue;
    root.querySelectorAll(`[data-document-id="${journal.id}"], [data-entry-id="${journal.id}"]`).forEach(el => el.remove());
  }
});
