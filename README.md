# Bingo Book & Target Book v0.3.1 — Foundry VTT v11

A gallery for **ready-made wanted poster images**, with two independently permissioned books. No poster-template generator is needed. The editor retains the light classic Foundry v11 paper layout.

## Features

- Top tabs: **Bingo Book** and **Target Book**. Players see only the books their GM permits.
- GM-only **Players** panel: grant or revoke **Bingo Book** and **Target Book** access separately for each player. Access is also enforced through the backing Journal permissions. Existing shared access from v0.3.0 is automatically copied to BOTH books on the first GM load; they can then be adjusted independently.
- Import complete PNG/JPEG/WEBP wanted posters with the Foundry FilePicker; optionally link an Actor and rename the entry.
- Status stamps (None, Wanted, Dead, Captured, Missing, Cleared) are translucent image overlays. Original image files are not altered.
- S, A, B, C, D rank badges (old numeric 5–1 ranks display as S–D) and card backgrounds: Parchment, Book Page, Dark Page, Clean Frame.
- **Show in Chat** beside the poster's name: choose **Everyone (public chat)** or **Selected players (private whisper)**. When private, select one or more recipients before sending. Chat includes the full image, rank and status stamp. GM recipients are included in whispers so the sender can view the post.
- A GM can explicitly share an individual poster to a player in chat without granting access to the underlying book. A chat share does not update book permissions.

## Install / Update

Manifest URL: `https://raw.githubusercontent.com/Daikaze/Bingo-Book/main/module.json`

ZIP: [`dist/bingo-book-v11-v0.3.1.zip`](dist/bingo-book-v11-v0.3.1.zip)

Always **back up your world** before upgrading. The module reuses existing v0.2/v0.3 Bingo & Target Journal pages, including their images and status metadata. It does not delete the source pictures. The original shared permission list is retained for migration. After updating, open **Players** to adjust separate book access.

Automated test checks cover permission migration, journal access synchronization, rank compatibility and public/private chat message routing. **Not verified in a live Foundry v11 client.**
