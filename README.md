# XOXO — Real-Time Multiplayer Tic Tac Toe

A production-quality online multiplayer Tic Tac Toe game built with vanilla HTML/CSS/JS and Firebase Realtime Database.

## Features

- Real-time game sync across devices via Firebase
- Create Room / Join Room with 6-character codes
- Score tracking across rounds (no page refresh needed)
- Win / Lose / Draw detection with animated highlight
- Confetti celebration on win
- Web Audio API sound effects (no files needed)
- Connection status indicator
- Graceful disconnect handling
- Fully responsive (mobile + desktop)
- Premium dark UI

---

## Firebase Setup (5 minutes)

### Step 1 — Create a Firebase project

1. Go to [https://console.firebase.google.com](https://console.firebase.google.com)
2. Click **Add project**, give it a name (e.g. `xoxo-game`), click through the wizard
3. Once created, click the **Web** icon `</>` under "Get started by adding Firebase to your app"
4. Register the app (any nickname), then copy the `firebaseConfig` object shown

### Step 2 — Enable Realtime Database

1. In the Firebase console, go to **Build → Realtime Database**
2. Click **Create Database**
3. Choose a region (any), start in **Test mode** (allows read/write for 30 days — fine for development)
4. Click **Enable**

### Step 3 — Set Database Rules (for production)

In the Firebase console under Realtime Database → Rules, paste:

```json
{
  "rules": {
    "rooms": {
      "$roomId": {
        ".read": true,
        ".write": true,
        ".validate": "newData.hasChildren(['board', 'turn', 'status', 'player1'])"
      }
    }
  }
}
```

Click **Publish**.

### Step 4 — Add your config to the game

Open `firebase-config.js` and replace the placeholder values with your real config:

```js
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "your-project.firebaseapp.com",
  databaseURL: "https://your-project-default-rtdb.firebaseio.com",
  projectId: "your-project",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};
```

---

## Run Locally

Because the game loads scripts from a CDN, you need a local HTTP server (not just opening `index.html` as a file).

### Option A — VS Code Live Server
1. Install the **Live Server** extension
2. Right-click `index.html` → **Open with Live Server**

### Option B — Node.js
```bash
npx serve .
# Open http://localhost:3000
```

### Option C — Python
```bash
python -m http.server 8080
# Open http://localhost:8080
```

---

## Deploy

### Netlify (recommended — free)
1. Go to [https://netlify.com](https://netlify.com) → **Add new site → Deploy manually**
2. Drag and drop the project folder
3. Your game is live at a `*.netlify.app` URL instantly

### Firebase Hosting
```bash
npm install -g firebase-tools
firebase login
firebase init hosting        # select your project, set public dir to "."
firebase deploy
```

### GitHub Pages
1. Push files to a GitHub repo
2. Go to repo Settings → Pages → Deploy from branch → `main` / `root`

---

## File Structure

```
GameDesign_XOXO/
├── index.html          Main HTML — all screens in one file
├── style.css           All styling (dark theme, animations, responsive)
├── game.js             All game logic, Firebase sync, audio
├── firebase-config.js  Your Firebase credentials (edit this)
└── README.md           This file
```

---

## How It Works

1. **Player A** enters a name, clicks **Create Room** → a room is written to Firebase with a random 6-char code
2. **Player B** on another device enters their name + the code, clicks **Join Room** → Firebase is updated, game starts
3. Both clients listen to the same Firebase path with `on('value', ...)` — any change (move, restart) is instantly synced to both
4. The player who makes a move writes the new board state to Firebase; the opponent's UI updates automatically
5. Win detection runs on the writing client before the update, so the result is embedded in the same atomic write
6. `onDisconnect()` hooks ensure online flags are cleared if a player closes the tab

---

## Keyboard Shortcuts

- `Enter` — Create Room (if room code field empty) or Join Room (if code entered)

---

## Customisation Tips

| What to change | Where |
|---|---|
| Colors (X / O / background) | CSS variables at top of `style.css` |
| Board size (3×3 → 4×4 etc.) | `WIN_COMBOS` array + grid in `style.css` |
| Sound effects | `SFX` object in `game.js` |
| Room code length | `genRoomId()` in `game.js` |
| Auto-expire rooms | Firebase TTL rules or Cloud Functions |
