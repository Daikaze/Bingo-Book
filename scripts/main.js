/**
 * Bingo Book + Target Book — Foundry VTT 11.
 * Two top-level books, GM-owned templates, journal-backed entries and player access.
 * No sample templates or preset poster art are included.
 */

const MOD = "bingo-book";
const BOOKS = {
  bingo: { title: "Bingo Book", icon: "fa-solid fa-book-open", name: "Bingo Book (Storage)" },
  target: { title: "Target Book", icon: "fa-solid fa-crosshairs", name: "Target Book (Storage)" }
};
const STATUSES = {
  active: "Active",
  claimed: "Claimed",
  lost: "Lost",
  dropped: "Dropped"
};

// On v11 use the original Application, Dialog, FilePicker and TextEditor APIs.
const generation = () => Number(game.release?.generation || parseInt(game.version, 10) || 11);
const USE_V2 = generation() >= 13 && !!foundry.applications?.api?.ApplicationV2;
const filePickerClass = () => (USE_V2 && foundry.applications?.apps?.FilePicker?.implementation) || FilePicker;
const textEditorClass = () => (USE_V2 && foundry.applications?.ux?.TextEditor?.implementation) || TextEditor;

const escapeHTML = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const pathToUrl = path => {
  if (!path) return "";
  if (/^(https?:|data:|blob:|\/)/i.test(path)) return path;
  return foundry.utils.getRoute ? foundry.utils.getRoute(path) : path;
};
const allowedUsers = () => game.settings.get(MOD, "allowedUsers") || {};
const canSee = (user = game.user) => !!(user.isGM || allowedUsers()[user.id]);
const allTemplates = () => game.settings.get(MOD, "templates") || { bingo: [], target: [] };
const bookTemplates = book => Array.isArray(allTemplates()[book]) ? allTemplates()[book] : [];
const selectedBook = () => BOOKS[state.book] ? state.book : "bingo";
const getBook = book => game.journal.find(j => j.getFlag(MOD, "book") === book) || null;
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
  const desired = ownershipFor();
  for (const journal of game.journal) {
    if (!journal.getFlag(MOD, "book")) continue;
    const changes = {};
    for (const user of game.users) {
      if (user.isGM) continue;
      if (desired[user.id] === 2 && journal.ownership?.[user.id] !== 2) changes[`ownership.${user.id}`] = 2;
      if (!desired[user.id] && journal.ownership?.[user.id] !== undefined) changes[`ownership.-=${user.id}`] = null;
    }
    if (Object.keys(changes).length) await journal.update(changes);
  }
}

/** Create the two storage journals, without creating default entries or templates. */
async function ensureBooks() {
  if (!game.user.isGM) return;
  for (const [id, info] of Object.entries(BOOKS)) {
    if (getBook(id)) continue;
    await JournalEntry.create({
      name: info.name,
      ownership: ownershipFor(),
      flags: { [MOD]: { book: id } }
    });
  }
}

/**
 * One-way, non-destructive migration from v0.1 category journals.
 * Each source page is identified by UUID and imported only once. The old journals
 * remain as GM-accessible backups; categories are not shown in the new UI.
 */
async function migrateOldCategories() {
  if (!game.user.isGM) return;
  const destination = getBook("bingo");
  if (!destination) return;
  for (const old of game.journal.filter(j => j.getFlag(MOD, "category"))) {
    for (const page of old.pages.contents) {
      const source = page.uuid || `${old.uuid}.JournalEntryPage.${page.id}`;
      if (destination.pages.contents.some(p => p.getFlag(MOD, "legacySource") === source)) continue;
      const data = page.toObject();
      delete data._id;
      delete data._stats;
      data.flags = foundry.utils.deepClone(data.flags || {});
      data.flags[MOD] = { ...(data.flags[MOD] || {}), legacySource: source, templateId: "" };
      await destination.createEmbeddedDocuments("JournalEntryPage", [data]);
    }
    // Private backup: old category should no longer be visible to players.
    const removals = {};
    if (old.ownership?.default !== 0) removals["ownership.default"] = 0;
    for (const user of game.users) {
      if (!user.isGM && old.ownership?.[user.id] !== undefined) removals[`ownership.-=${user.id}`] = null;
    }
    if (Object.keys(removals).length) await old.update(removals);
  }
}

const state = { book: "bingo", panel: null };
let windowInstance = null;
let renderSequence = 0;

function renderApplication(app) {
  if (!app) return;
  if (USE_V2 && app instanceof foundry.applications.api.ApplicationV2) app.render({ force: true });
  else app.render(true);
}

async function confirmAction(title, message) {
  if (USE_V2 && foundry.applications?.api?.DialogV2?.confirm) {
    return foundry.applications.api.DialogV2.confirm({ window: { title }, content: `<p>${message}</p>`, rejectClose: false });
  }
  return Dialog.confirm({ title, content: `<p>${message}</p>` });
}

function refreshSceneControls() {
  try {
    if (typeof ui.controls?.initialize === "function") ui.controls.initialize();
    else ui.controls?.render({ reset: true });
  } catch (error) { console.warn(`${MOD} | Scene controls could not refresh`, error); }
}

function refresh() {
  if (windowInstance?.rendered && windowInstance.rootEl?.isConnected) draw(windowInstance.rootEl);
}
const refreshSoon = foundry.utils.debounce(refresh, 60);

function linkedDocument(uuid) {
  if (!uuid) return null;
  try { return fromUuidSync(uuid) || null; } catch (_error) { return null; }
}

async function enrichedText(page) {
  return textEditorClass().enrichHTML(page.text?.content || "", {
    relativeTo: page,
    secrets: page.isOwner,
    ...(generation() <= 11 ? { async: true } : {})
  });
}

function pickImage(current, callback) {
  const picker = new (filePickerClass())({
    type: "image",
    current: current || "",
    callback: path => Promise.resolve(callback(path)).catch(error => {
      console.error(`${MOD} | Failed to select image`, error);
      ui.notifications.error("The image could not be saved.");
    })
  });
  picker.browse().catch(error => {
    console.error(`${MOD} | File picker failed`, error);
    ui.notifications.error("Could not open Foundry's file picker.");
  });
}

function entryHTML(page, gm, book, templates) {
  const status = page.getFlag(MOD, "status") || "active";
  const reward = page.getFlag(MOD, "reward") || "";
  const uuid = page.getFlag(MOD, "uuid") || "";
  const linked = linkedDocument(uuid);
  const portrait = page.getFlag(MOD, "image") || (linked?.documentName === "Actor" ? linked.img : "") || "";
  const templateId = page.getFlag(MOD, "templateId") || "";
  const template = templates.find(t => t.id === templateId && t.image);
  const fit = template?.fit === "contain" ? "contain" : "cover";
  const placement = template?.placement === "top" ? "top" : "bottom";
  const statusLabel = status === "active" ? (book === "bingo" ? "Wanted" : "Targeted") : (STATUSES[status] || status);
  const selectStatus = Object.entries(STATUSES).map(([key, value]) =>
    `<option value="${key}"${key === status ? " selected" : ""}>${key === "active" ? (book === "bingo" ? "Wanted" : "Targeted") : value}</option>`).join("");
  const link = linked
    ? `<div class="bb-link"><a data-act="open-link" title="Open linked sheet"><i class="fa-solid fa-link"></i> ${escapeHTML(linked.name)}</a>${gm ? `<button data-act="clear-link" type="button" title="Remove link"><i class="fa-solid fa-xmark"></i></button>` : ""}</div>`
    : (gm ? `<div class="bb-link bb-muted">Drop an Actor or Item here to link it</div>` : "");
  const imageBox = portrait
    ? `<img class="bb-entry-portrait-img" src="${escapeHTML(pathToUrl(portrait))}" alt="Portrait of ${escapeHTML(page.name)}">`
    : `<div class="bb-portrait-placeholder"><i class="fa-regular fa-image"></i><span>${gm ? "Choose portrait" : "No portrait"}</span></div>`;

  return `<article class="bb-entry ${template ? "bb-has-template" : ""}" data-page="${escapeHTML(page.id)}">
    <div class="bb-paper bb-place-${placement}">
      ${template ? `<img class="bb-template-back bb-fit-${fit}" src="${escapeHTML(pathToUrl(template.image))}" alt="">` : ""}
      <div class="bb-paper-content">
        <div class="bb-entry-topline"><span>${book === "bingo" ? "BINGO BOOK" : "TARGET BOOK"}</span><span class="bb-status-badge bb-status-${escapeHTML(status)}">${escapeHTML(statusLabel)}</span></div>
        <div class="bb-entry-portrait"${gm ? ` data-act="pick-portrait" title="Choose portrait" role="button" tabindex="0"` : ""}>${imageBox}</div>
        ${gm ? `<input class="bb-entry-name" type="text" data-field="name" aria-label="Name" value="${escapeHTML(page.name)}">` : `<h3 class="bb-entry-name">${escapeHTML(page.name)}</h3>`}
        ${(gm || reward) ? `<div class="bb-reward"><label>Reward / Notes</label>${gm ? `<input data-field="reward" type="text" value="${escapeHTML(reward)}" placeholder="Reward or short note">` : `<strong>${escapeHTML(reward)}</strong>`}</div>` : ""}
        <div class="bb-entry-desc" data-desc="${escapeHTML(page.id)}"></div>
        ${link}
      </div>
    </div>
    ${gm ? `<footer class="bb-entry-footer">
      <label class="bb-control-field">Status <select data-field="status" aria-label="Status">${selectStatus}</select></label>
      <label class="bb-control-field bb-template-field">Template <select data-field="templateId" aria-label="Template"><option value="">None</option>${templates.map(t => `<option value="${escapeHTML(t.id)}"${t.id === templateId ? " selected" : ""}>${escapeHTML(t.name)}</option>`).join("")}</select></label>
      <button type="button" data-act="edit-desc" class="bb-icon-btn" title="Edit description in Foundry Journal"><i class="fa-solid fa-pen-to-square"></i></button>
      <button type="button" data-act="delete-entry" class="bb-icon-btn bb-danger" title="Delete entry"><i class="fa-solid fa-trash"></i></button>
    </footer>` : ""}
  </article>`;
}

function templateManagerHTML(templates, book) {
  return `<section class="bb-manager">
    <div class="bb-manager-heading"><div><h3>${escapeHTML(BOOKS[book].title)} — My Templates</h3>
      <p>Upload your own image templates. The module does not ship with any preset posters.</p></div>
      <button type="button" class="bb-primary" data-act="add-template"><i class="fa-solid fa-plus"></i> Add template</button></div>
    <div class="bb-template-list">${templates.length ? templates.map(t => `<div class="bb-template-row" data-template="${escapeHTML(t.id)}">
      <div class="bb-template-preview">${t.image ? `<img src="${escapeHTML(pathToUrl(t.image))}" alt="${escapeHTML(t.name)}">` : `<i class="fa-regular fa-image"></i>`}</div>
      <div class="bb-template-options"><label>Name<input type="text" data-template-field="name" value="${escapeHTML(t.name)}"></label>
        <label>Image sizing<select data-template-field="fit"><option value="cover"${t.fit !== "contain" ? " selected" : ""}>Fill (crop)</option><option value="contain"${t.fit === "contain" ? " selected" : ""}>Fit whole image</option></select></label>
        <label>Text area<select data-template-field="placement"><option value="bottom"${t.placement !== "top" ? " selected" : ""}>Bottom</option><option value="top"${t.placement === "top" ? " selected" : ""}>Top</option></select></label></div>
      <div class="bb-template-buttons"><button type="button" data-act="change-template-image" title="Change template image"><i class="fa-solid fa-image"></i> Image</button><button type="button" data-act="remove-template" class="bb-danger" title="Remove template"><i class="fa-solid fa-trash"></i></button></div>
    </div>`).join("") : `<div class="bb-panel-empty"><i class="fa-regular fa-image"></i><p>No templates added yet.</p><span>Click Add template and select an image from Foundry's file picker.</span></div>`}</div>
  </section>`;
}

function playerManagerHTML() {
  const access = allowedUsers();
  const users = game.users.filter(user => !user.isGM);
  return `<section class="bb-manager bb-player-manager"><h3>Player Access</h3>
    <p>Choose who can open Bingo Book and Target Book. Only the GM can create or edit entries and templates.</p>
    <div class="bb-player-list">${users.length ? users.map(user => `<label class="bb-player"><input type="checkbox" data-user="${escapeHTML(user.id)}"${access[user.id] ? " checked" : ""}><span>${escapeHTML(user.name)}</span></label>`).join("") : `<p>No players in this world.</p>`}</div>
  </section>`;
}

async function draw(root) {
  if (!root?.isConnected) return;
  const sequence = ++renderSequence;
  const book = selectedBook();
  const gm = game.user.isGM;
  const templates = bookTemplates(book);
  const entries = getEntries(book);
  const panel = gm ? state.panel : null;
  const bookInfo = BOOKS[book];
  const content = panel === "templates" ? templateManagerHTML(templates, book)
    : panel === "players" ? playerManagerHTML()
    : entries.length ? `<div class="bb-grid">${entries.map(page => entryHTML(page, gm, book, templates)).join("")}</div>`
    : `<div class="bb-empty"><i class="${bookInfo.icon}"></i><h3>${escapeHTML(bookInfo.title)} is empty</h3><p>${gm ? "Click Add Entry to create your first entry. You can optionally upload your own image templates." : "No entries have been added yet."}</p></div>`;

  root.innerHTML = `<div class="bb-shell">
    <nav class="bb-top-tabs" aria-label="Books">
      ${Object.entries(BOOKS).map(([id, bookData]) => `<button type="button" data-act="switch-book" data-book="${id}" class="bb-tab ${book === id ? "active" : ""}" aria-selected="${book === id}"><i class="${bookData.icon}"></i><span>${bookData.title}</span></button>`).join("")}
    </nav>
    <header class="bb-toolbar"><div class="bb-title"><h2>${panel === "players" ? "Player Access" : escapeHTML(bookInfo.title)}</h2><span>${panel ? (panel === "templates" ? "Custom template library" : "Both books") : `${entries.length} ${entries.length === 1 ? "entry" : "entries"}`}</span></div>
      ${gm ? `<div class="bb-actions"><button type="button" data-act="show-templates" class="${panel === "templates" ? "bb-selected" : ""}"><i class="fa-solid fa-layer-group"></i> Templates</button>
      <button type="button" data-act="show-players" class="${panel === "players" ? "bb-selected" : ""}"><i class="fa-solid fa-users"></i> Players</button>
      <button type="button" data-act="add-entry" class="bb-primary"><i class="fa-solid fa-plus"></i> Add Entry</button></div>` : ""}
    </header>
    <main class="bb-main">${content}</main>
  </div>`;

  if (panel) return;
  await Promise.all(entries.map(async page => {
    const target = Array.from(root.querySelectorAll("[data-desc]")).find(el => el.dataset.desc === page.id);
    if (!target) return;
    try {
      const html = await enrichedText(page);
      if (renderSequence !== sequence || !target.isConnected) return;
      target.innerHTML = html || (gm ? `<p class="bb-description-hint">Use the edit button to add text, links, and images.</p>` : "");
    } catch (error) { console.warn(`${MOD} | Description could not be rendered`, page.name, error); }
  }));
}

async function modifyTemplates(book, transform) {
  if (!game.user.isGM) return;
  const values = foundry.utils.deepClone(allTemplates());
  const current = Array.isArray(values[book]) ? values[book] : [];
  values[book] = transform(current);
  await game.settings.set(MOD, "templates", values);
  refresh();
}

async function openLinked(uuid) {
  if (!uuid) return;
  const doc = await fromUuid(uuid);
  if (!doc?.sheet) return;
  if (!game.user.isGM && !doc.testUserPermission?.(game.user, "LIMITED")) {
    ui.notifications.warn("You do not have permission to view this document.");
    return;
  }
  renderApplication(doc.sheet);
}

function mount(root, app) {
  if (!root) return;
  app.rootEl = root;
  // Prevent duplicate event handlers if ApplicationV2 decides to re-render its template.
  if (root.dataset.bbMounted === "yes") { draw(root); return; }
  root.dataset.bbMounted = "yes";

  const entryFor = el => {
    const pageId = el.closest("[data-page]")?.dataset.page;
    return pageId ? getBook(selectedBook())?.pages.get(pageId) : null;
  };

  root.addEventListener("click", async event => {
    const documentLink = event.target.closest("a.content-link[data-uuid]");
    if (documentLink) {
      event.preventDefault();
      event.stopPropagation();
      await openLinked(documentLink.dataset.uuid);
      return;
    }
    const actionElement = event.target.closest("[data-act]");
    if (!actionElement) return;
    const action = actionElement.dataset.act;
    const gm = game.user.isGM;

    if (action === "switch-book") {
      state.book = actionElement.dataset.book;
      state.panel = null;
      refresh();
      return;
    }
    if (!gm) {
      if (action === "open-link") await openLinked(entryFor(actionElement)?.getFlag(MOD, "uuid"));
      return;
    }

    try {
      switch (action) {
        case "show-templates":
          state.panel = state.panel === "templates" ? null : "templates";
          refresh();
          break;
        case "show-players":
          state.panel = state.panel === "players" ? null : "players";
          refresh();
          break;
        case "add-entry": {
          const journal = getBook(selectedBook());
          if (!journal) {
            ui.notifications.warn("Book storage is still initializing. Please reopen the window.");
            await ensureBooks();
            refresh();
            break;
          }
          state.panel = null;
          await journal.createEmbeddedDocuments("JournalEntryPage", [{
            name: "New Entry", type: "text", text: { content: "", format: 1 },
            flags: { [MOD]: { image: "", reward: "", status: "active", uuid: "", templateId: "" } }
          }]);
          refresh();
          break;
        }
        case "pick-portrait": {
          const page = entryFor(actionElement);
          if (page) pickImage(page.getFlag(MOD, "image"), path => page.setFlag(MOD, "image", path));
          break;
        }
        case "edit-desc": renderApplication(entryFor(actionElement)?.sheet); break;
        case "delete-entry": {
          const page = entryFor(actionElement);
          if (page && await confirmAction("Delete Entry", `Permanently delete <strong>${escapeHTML(page.name)}</strong>?`)) await page.delete();
          break;
        }
        case "open-link": await openLinked(entryFor(actionElement)?.getFlag(MOD, "uuid")); break;
        case "clear-link": await entryFor(actionElement)?.unsetFlag(MOD, "uuid"); break;
        case "add-template": {
          const book = selectedBook();
          pickImage("", async path => {
            let filename = path.split("/").pop().split("?")[0] || "My Template";
            try { filename = decodeURIComponent(filename); } catch (_error) { /* Keep original filename. */ }
            const name = filename.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
            await modifyTemplates(book, templates => [...templates, {
              id: foundry.utils.randomID(), name: name || "My Template", image: path, fit: "cover", placement: "bottom"
            }]);
          });
          break;
        }
        case "change-template-image": {
          const id = actionElement.closest("[data-template]")?.dataset.template;
          const book = selectedBook();
          const current = bookTemplates(book).find(t => t.id === id);
          if (current) pickImage(current.image, path => modifyTemplates(book, templates => templates.map(t => t.id === id ? { ...t, image: path } : t)));
          break;
        }
        case "remove-template": {
          const id = actionElement.closest("[data-template]")?.dataset.template;
          const book = selectedBook();
          const current = bookTemplates(book).find(t => t.id === id);
          if (current && await confirmAction("Remove Template", `Remove template <strong>${escapeHTML(current.name)}</strong>? Entries using it will stay intact but lose their background.`)) {
            await modifyTemplates(book, templates => templates.filter(t => t.id !== id));
          }
          break;
        }
      }
    } catch (error) {
      console.error(`${MOD} | Could not perform ${action}`, error);
      ui.notifications.error(`Bingo Book: ${error.message || "Action failed"}`);
    }
  });

  root.addEventListener("keydown", event => {
    if ((event.key === "Enter" || event.key === " ") && event.target.matches("[data-act='pick-portrait']")) {
      event.preventDefault(); event.target.click();
    }
  });

  root.addEventListener("change", async event => {
    if (!game.user.isGM) return;
    const target = event.target;
    try {
      if (target.matches("[data-user]")) {
        await game.settings.set(MOD, "allowedUsers", { ...allowedUsers(), [target.dataset.user]: target.checked });
        await syncOwnership();
        return;
      }
      if (target.matches("[data-template-field]")) {
        const id = target.closest("[data-template]")?.dataset.template;
        const field = target.dataset.templateField;
        if (!id || !["name", "fit", "placement"].includes(field)) return;
        const value = field === "name" ? (target.value.trim() || "My Template") : target.value;
        const book = selectedBook();
        await modifyTemplates(book, templates => templates.map(t => t.id === id ? { ...t, [field]: value } : t));
        return;
      }
      if (!target.matches("[data-field]")) return;
      const page = entryFor(target);
      if (!page) return;
      const value = target.value;
      switch (target.dataset.field) {
        case "name": await page.update({ name: value.trim() || "New Entry" }); break;
        case "reward": await page.setFlag(MOD, "reward", value); break;
        case "status": if (Object.hasOwn(STATUSES, value)) await page.setFlag(MOD, "status", value); break;
        case "templateId": {
          if (!value || bookTemplates(selectedBook()).some(t => t.id === value)) await page.setFlag(MOD, "templateId", value);
          break;
        }
      }
    } catch (error) {
      console.error(`${MOD} | Field could not be saved`, error);
      ui.notifications.error("Could not save the change.");
    }
  });

  root.addEventListener("dragover", event => {
    if (game.user.isGM && event.target.closest(".bb-entry")) event.preventDefault();
  });
  root.addEventListener("drop", async event => {
    if (!game.user.isGM || !event.target.closest(".bb-entry")) return;
    event.preventDefault();
    let data;
    try { data = JSON.parse(event.dataTransfer?.getData("text/plain") || "null"); } catch (_error) { return; }
    if (!["Actor", "Item"].includes(data?.type)) {
      ui.notifications.warn("Drop an Actor or Item to link it to the entry.");
      return;
    }
    const uuid = data.uuid || (data.id ? `${data.type}.${data.id}` : "");
    if (!uuid) return;
    const page = entryFor(event.target);
    if (page) await page.setFlag(MOD, "uuid", uuid);
  });

  draw(root);
}

let BookWindow;
if (USE_V2) {
  const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
  BookWindow = class BookWindow extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
      id: MOD, classes: ["bingo-book"], position: { width: 1060, height: 730 },
      window: { title: "Bingo Book / Target Book", icon: "fa-solid fa-book-open", resizable: true }
    };
    static PARTS = { main: { template: `modules/${MOD}/templates/book.hbs` } };
    _onRender(context, options) {
      super._onRender?.(context, options);
      mount(this.element.querySelector(".bb-root"), this);
    }
  };
} else {
  BookWindow = class BookWindow extends Application {
    static get defaultOptions() {
      return foundry.utils.mergeObject(super.defaultOptions, {
        id: MOD, classes: ["bingo-book"], template: `modules/${MOD}/templates/book.hbs`,
        title: "Bingo Book / Target Book", width: 1060, height: 730, resizable: true
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
  if (!canSee()) {
    ui.notifications.warn("You have not been granted access to the books.");
    return;
  }
  if (book && BOOKS[book]) state.book = book;
  state.panel = null;
  if (windowInstance?.rendered) {
    refresh();
    if (USE_V2) windowInstance.bringToFront();
    else windowInstance.bringToTop();
    return;
  }
  windowInstance = new BookWindow();
  renderApplication(windowInstance);
}

Hooks.once("init", () => {
  game.settings.register(MOD, "allowedUsers", {
    name: "Allowed Players", scope: "world", config: false, type: Object, default: {},
    onChange: () => {
      refreshSceneControls();
      if (!canSee() && windowInstance?.rendered) windowInstance.close();
      else refresh();
    }
  });
  game.settings.register(MOD, "templates", {
    name: "Custom Image Templates", scope: "world", config: false, type: Object,
    default: { bingo: [], target: [] }, onChange: refresh
  });
});

Hooks.once("ready", async () => {
  game.modules.get(MOD).api = { open: openBook, openBingo: () => openBook("bingo"), openTarget: () => openBook("target") };
  if (game.user.isGM) {
    try {
      await ensureBooks();
      await migrateOldCategories();
      await syncOwnership();
    } catch (error) {
      console.error(`${MOD} | Initialization/migration failed`, error);
      ui.notifications.error("Bingo Book: check the browser console for a storage initialization error.");
    }
  }
  refreshSoon();
});

Hooks.on("getSceneControlButtons", controls => {
  const tool = {
    name: MOD, title: "Bingo Book / Target Book", icon: "fa-solid fa-book-open",
    button: true, visible: canSee(), onClick: () => openBook(), onChange: () => openBook()
  };
  if (Array.isArray(controls)) {
    controls.find(group => group.name === "token")?.tools.push(tool);
  } else {
    const group = controls.tokens || controls.token;
    if (group) {
      tool.order = Object.keys(group.tools).length;
      group.tools[MOD] = tool;
    }
  }
});

for (const hook of [
  "createJournalEntry", "updateJournalEntry", "deleteJournalEntry",
  "createJournalEntryPage", "updateJournalEntryPage", "deleteJournalEntryPage"
]) Hooks.on(hook, () => { if (windowInstance?.rendered) refreshSoon(); });

// The storage journals are not meant to clutter the player Journal directory.
Hooks.on("renderJournalDirectory", (app, html) => {
  if (game.user.isGM) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root) return;
  for (const journal of game.journal) {
    if (!(journal.getFlag(MOD, "book") || journal.getFlag(MOD, "category"))) continue;
    root.querySelectorAll(`[data-document-id="${journal.id}"], [data-entry-id="${journal.id}"]`).forEach(el => el.remove());
  }
});
