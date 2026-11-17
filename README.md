# Solmar Heat — an open-world crime game

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/Alim-14-code/solmar-heat/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/Alim-14-code/solmar-heat/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

A top-down open-world crime game in the spirit of GTA, built for the
make.fun `gta6-01` bounty. Everything is original: the city of Solmar, its
people, its cars, its story, its art and its sounds.

## The story

Dario Cruz is back in Solmar, broke and owing Big Sal $50,000. Six missions
take him from Mama Luz's diner to the docks, a joyride, a warehouse payback,
a getaway and one last bank job. Finish the story and Solmar is yours to
free-roam.

## Play

Serve `game/` with any static server (or `node serve.ts`) and open it in
desktop Chrome. No network needed — every file is local.

- **WASD / arrows** — move on foot, drive in a car
- **E** — enter / steal a car, talk to mission contacts
- **Mouse** — aim, **click** — shoot, **R** — reload
- **F / Space** — punch, **Shift** — sprint, **Space** — handbrake in a car
- **P / Esc** — pause and save, **Q** — quick save, **M** — mute

## What's in it

- A 7×7-block city: roads, traffic, pedestrians, parks, a beach and a
  marina, with named landmarks the missions point at
- 8 car models to steal and drive, with arcade handling, damage and smoke
- Wanted level 0–5: patrol cars chase and ram, officers get out to arrest
- Combat: pistol with ammo and reload, punching, gang shootouts
- HUD with health, money, wanted stars, clock, speedometer and a live
  minimap with mission markers
- 6 story missions with briefings, objectives and rewards, plus free roam
- Saves to localStorage (Q or the pause menu); progress carries over
- Synthesised WebAudio: engine, sirens, gunfire, pickups and a bass loop

## Layout

- `game/index.html` — the page
- `game/src/` — the game, one job per file:
  - `config.js` — tuning, palette, city constants
  - `random.js` — seeded RNG
  - `city.js` — city generation and building collision
  - `world.js` — the simulation: player, cars, traffic, police, combat
  - `missions.js` — the six-mission story
  - `render.js` — all drawing: city, HUD, minimap, menus
  - `input.js` — keyboard and mouse
  - `audio.js` — synthesised sound
  - `shots.js` — deterministic staged scenes for screenshots
  - `main.js` — boot, loop, screens, save/load
- `screenshots/` — 4 real renders of the game, taken in headless Chromium
- `main.ts` — the entry program: copies `game/` and `screenshots/` to
  `/output` and writes `dossier.json`
- `serve.ts` — a tiny static server for local play
- `shots.json` — the four screenshot scenes

## License

MIT — see `LICENSE`.
