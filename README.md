# Bingo Book & Target Book v0.2.1 — Foundry VTT v11

Wanted posters are **complete image files you supply**, not compositions assembled by the module. The original v0.1 parchment/wood visual style is restored, while navigation uses two **top-level tabs** for Bingo Book and Target Book.

## How to use

1. Open the book from **Token Controls**.
2. Select **Bingo Book** or **Target Book** at the top.
3. As GM, click **Add Poster Image** and choose or upload an existing poster PNG, JPG, or WEBP using Foundry's own image browser.
4. The entire picture appears unchanged — **no crop, color filter, 'Wanted' text, generated rank, generated reward, notes, or template layer**.
5. Click an image or its picture icon to replace it. You can edit the name, update status, delete the image entry, or drop an Actor/Item onto a card to link its sheet.
6. **Players** sets who may view the books (read-only for non-GMs).

## Installing

Unzip into `FoundryVTT/Data/modules/` so that `bingo-book/module.json` exists, then enable the module in the world. Foundry v11 compatibility is the target. You can alternatively use the module manifest URL:

`https://raw.githubusercontent.com/Daikaze/Bingo-Book/main/module.json`

## Updating safely

**Back up your world** first. Existing v0.2.0 Bingo/Target Book JournalEntries and pictures are reused, including poster image paths stored in `flags.bingo-book.image`. If an entry has no image path but selected a custom v0.2.0 image template, the template image is displayed as a fallback. The prior templates setting is retained for compatibility, but its manager and selector are removed. Other old metadata is not deleted.

Original v0.1.x category posters are automatically copied into Bingo Book once; source journals remain as private backups. Nothing is removed from either book when updating. The actual image files stay in your Foundry user data, not in this package.

Console API: `game.modules.get("bingo-book").api.open()`, `.openBingo()`, `.openTarget()`.
