
## Regressed level runs low vs the game
- Players past their regression age show a level a few points higher in Hoop Land than in the app (e.g. 64 in game, 58 in app; adding one year to his regression age moves the app from 58 to 64).
- Likely cause: `REG_DROP` in `js/regression.js` was measured on 20/20 players; the real drop probably scales with the rating total.
- Status: flagged, left as is. Needs more game-vs-app samples (age, regression age, full ratings) to fit.
