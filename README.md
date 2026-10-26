# Bingo Book & Target Book — v0.2.0 (Foundry VTT v11)

Two **top navigation tabs** in one window: **Bingo Book** and **Target Book**. There are **no sidebar categories** and **no bundled or preset templates**.

## Install from GitHub

Use the Foundry VTT **Install Module** manifest URL:

`https://raw.githubusercontent.com/Daikaze/Bingo-Book/main/module.json`

Or download the packaged release ZIP: [bingo-book-v11-v0.2.0.zip](https://raw.githubusercontent.com/Daikaze/Bingo-Book/main/dist/bingo-book-v11-v0.2.0.zip).

## Install in v11

1. Unzip into `<Foundry User Data>/Data/modules/bingo-book/` (do not nest a second `bingo-book` folder).
2. Enable **Bingo Book & Target Book** in your world; reload Foundry.
3. Use the book button in the **Token Controls** toolbar.

## Use

- Switch between the **Bingo Book** and **Target Book** tabs at the top. Both have separate entries and custom template libraries.
- **Add Entry** adds a new journal-backed entry to the current book (GM only).
- Click an entry's portrait area to choose its image via the standard Foundry file picker.
- Edit name, reward/note, and status in the card. Click the edit icon to open Foundry's **Journal page editor** for descriptions, resizable embedded images, and rich text / document links.
- Drag an **Actor** or **Item** onto the entry to link it, and click the displayed link to open its sheet (permission permitting).
- Click **Templates** to upload your own image templates, rename them, choose image sizing (fill/fit), and change content position (top/bottom). Then select a template on any entry's **Template** dropdown. There are no bundled image templates.
- Click **Players** to authorize player access. The GM alone can edit entries, templates, and access.

## Storage and upgrading

Entries live as JournalEntryPage documents in two automatically created JournalEntries, while template **image paths and settings** are saved as Foundry world settings. Upload or select the actual image file using the native FilePicker. Images are never packaged into the module.

Old `0.1.x` *category* journals are automatically **copied** into Bingo Book on the first GM login after updating. They stay in the world as backups and are made private to players. The import is repeat-safe: old pages are identified by a saved legacy UUID, preventing duplicates during subsequent logins. **Back up your Foundry world before upgrading.**

Console API: `game.modules.get("bingo-book").api.open()`, `.openBingo()`, `.openTarget()`.

## Compatibility

This release specifically targets **Foundry VTT v11**, using its original Application, FilePicker, Dialog and Journal APIs. Other releases may require additional testing.
