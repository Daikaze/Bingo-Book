# Bingo Book & Target Book 0.3.0 — Foundry VTT V11

A wanted-poster library for Foundry Virtual Tabletop v11. Import **complete poster images** (no generated poster templates). Select Bingo Book or Target Book with the top tabs. The editor uses a light, parchment-style v11 interface.

## Features
- Select **Bingo Book** or **Target Book** using the top tabs.
- GM: add poster, choose an image with Foundry FilePicker, optionally link an Actor, and rename the entry.
- Choose a **Status** (None, Wanted, Dead, Captured, Missing, Cleared). The translucent stamp overlays the image without editing the original file.
- Choose a **Rank** from S, A, B, C, D. The rank is shown in a small badge.
- Choose the card **Background**: Parchment, Book Page, Dark Page, Clean Frame.
- Player access is controlled by the GM via **Players**. Players only see shared posters and cannot edit.
- Existing v0.2.1 book journals are reused; existing images remain referenced in Foundry user data. Original v0.1 category journals are not deleted.

## Install

Use the module manifest URL in Foundry's Install Module interface:

`https://raw.githubusercontent.com/Daikaze/Bingo-Book/main/module.json`

Or download the zip from [`dist/bingo-book-v11-v0.3.0.zip`](dist/bingo-book-v11-v0.3.0.zip) and extract it so the module is at `Data/modules/bingo-book/module.json`.

**Back up your Foundry world before updating.** Foundry V11 is the compatibility target. JavaScript syntax and archive integrity were checked; the package has not been tested inside a live Foundry world.
