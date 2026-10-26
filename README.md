# Bingo Book & Target Book v0.3.5 — Foundry VTT v11

A gallery for **ready-made wanted poster images**, with two independently permissioned books. No poster-template generator is needed. The editor retains the light classic Foundry v11 paper layout.

## Features

- Top tabs: **Bingo Book** and **Target Book**. Players see only the books their GM permits.
- GM-only **Players** panel: grant or revoke **Bingo Book** and **Target Book** access separately for each player. Access is also enforced through the backing Journal permissions. Existing shared access from v0.3.0 is automatically copied to BOTH books on the first GM load; they can then be adjusted independently.
- Import complete PNG/JPEG/WEBP wanted posters with the Foundry FilePicker; optionally link an Actor and rename the entry.
- Status stamps (None, Wanted, Dead, Captured, Missing, Cleared) are small, responsive, fully legible corner seals in both previews and chat; they no longer cover the whole art. Original image files are not altered.
- The editor keeps its scroll position (and does not rebuild dropdown controls) when the GM changes status, rank, background, actor or notes.
- S, A, B, C, D rank badges (old numeric 5–1 ranks display as S–D) and card backgrounds: Parchment, Book Page, Dark Page, Clean Frame.
- **Show in Chat** beside the poster's name: choose **Everyone (public chat)** or **Selected players (private whisper)**. When private, select one or more recipients before sending. Chat includes the full image, rank and status stamp. GM recipients are included in whispers so the sender can view the post.
- A GM can explicitly share an individual poster to a player in chat without granting access to the underlying book. A chat share does not update book permissions.

## Install / Update

Manifest URL: `https://raw.githubusercontent.com/Daikaze/Bingo-Book/main/module.json`

ZIP: [`dist/bingo-book-v11-v0.3.5.zip`](dist/bingo-book-v11-v0.3.5.zip)

Always **back up your world** before upgrading. The module reuses existing v0.2/v0.3 Bingo & Target Journal pages, including their images and status metadata. It does not delete the source pictures. The original shared permission list is retained for migration. After updating, open **Players** to adjust separate book access.

Automated test checks cover permission migration, journal access synchronization, rank compatibility and public/private chat message routing. **Not verified in a live Foundry v11 client.**


## Version 0.3.4

- Restores the original v0.3.2 two-pane book layout for players and GMs. Removes the separate player gallery introduced in v0.3.3.
- Chat posters now use the whole image with its natural aspect ratio and responsive width. Frame, image, rank and status seal adapt to the narrow chat sidebar without cropping.
- Preserves separate Bingo/Target player access and Show in Chat (all or selected recipients).

## Version 0.3.5

- Restores the larger angled **stamp** lettering in chat without clipping the poster.
- Preserves the full poster image proportions and the two-pane book interface from v0.3.4.
- Player access and targeted Show in Chat recipients remain unchanged.


## Version 0.3.6

- Players retain the two-pane book layout but see **only** the poster image and title, not the GM editor (Title, Actor, Art, Style, Notes).
- Rank categories (All, S, A, B, C, D) in the left sidebar filter existing posters without duplicating data. Legacy numeric ranks are mapped to S–D.
- The original large diagonal status stamp is restored; it scales to fit complete uncropped chat poster images, including long words.
- Separate Bingo/Target permissions and targeted Show in Chat remain intact.


## v0.3.7: Bounty sorting

Within any Rank S–D category, select Original order, Highest to Lowest, or Lowest to Highest. The choice is separate for Bingo Book and Target Book. A GM may enter Bounty (GP) for each poster; old reward flags are also recognized. The module does not attempt to read gold amounts out of uploaded poster images. Entries without bounty appear last in either numeric order. Nothing else in the poster or chat UI changes.
