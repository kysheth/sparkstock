# 🚀 Spark Stock — Deployment Guide
### Getting your app live on the internet with Firebase + Vercel

This guide walks you through every step. It should take about 30–45 minutes total.

---

## What you'll end up with
- A live URL (e.g. `sparkstock.vercel.app`) anyone on your team can open
- Real-time sync across all devices
- Free hosting (Firebase free tier + Vercel free tier)

---

## PART 1 — Set up Firebase (your database)

### Step 1: Create a Firebase project
1. Go to **https://console.firebase.google.com**
2. Click **"Add project"**
3. Name it `sparkstock` (or anything you like)
4. Disable Google Analytics (not needed) → click **Create project**
5. Wait for it to finish, then click **Continue**

---

### Step 2: Create a Firestore database
1. In the left sidebar, click **"Firestore Database"**
2. Click **"Create database"**
3. Choose **"Start in production mode"** → click Next
4. Pick any location close to you (e.g. `us-east1`) → click **Enable**
5. Wait for it to finish setting up

---

### Step 3: Set Firestore security rules
1. In Firestore, click the **"Rules"** tab at the top
2. Delete everything in the editor and paste this:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /sparkstock/{document} {
      allow read: if true;
      allow write: if true;
    }
  }
}
```

3. Click **"Publish"**

---

### Step 4: Get your Firebase credentials
1. Click the ⚙️ gear icon next to "Project Overview" in the left sidebar
2. Click **"Project settings"**
3. Scroll down to **"Your apps"**
4. Click the **`</>`** (Web) icon to add a web app
5. Give it a nickname like `sparkstock-web` → click **"Register app"**
6. You'll see a block of code like this — **keep this window open**, you'll need it:

```js
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "sparkstock-xxxxx.firebaseapp.com",
  projectId: "sparkstock-xxxxx",
  storageBucket: "sparkstock-xxxxx.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef"
};
```

---

### Step 5: Paste your credentials into the app
1. Open the file **`src/firebase.js`** in a text editor (TextEdit on Mac, Notepad on Windows)
2. Replace each `REPLACE_WITH_YOUR_...` value with the matching value from Step 4
3. Save the file

It should look something like:
```js
const firebaseConfig = {
  apiKey:            "AIzaSy...",
  authDomain:        "sparkstock-abc12.firebaseapp.com",
  projectId:         "sparkstock-abc12",
  storageBucket:     "sparkstock-abc12.appspot.com",
  messagingSenderId: "987654321",
  appId:             "1:987654321:web:abc123def456",
};
```

---

## PART 2 — Set up GitHub (where your code lives)

### Step 6: Create a GitHub repository
1. Go to **https://github.com** and sign in (create a free account if needed)
2. Click the **"+"** icon in the top right → **"New repository"**
3. Name it `sparkstock`
4. Leave it **Public** (Vercel's free tier works best with public repos)
5. Click **"Create repository"**

---

### Step 7: Upload your project files to GitHub
You have two options here. Option A is easiest if you're not comfortable with the terminal.

**Option A — Upload via the GitHub website:**
1. On your new repository page, click **"uploading an existing file"**
2. Drag and drop the entire `sparkstock` folder's contents into the window
   - Make sure to include: `src/` folder, `index.html`, `package.json`, `vite.config.js`, `.gitignore`
   - Do NOT upload `node_modules` if it exists
3. Click **"Commit changes"**

**Option B — Use the terminal:**
```bash
cd sparkstock
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/sparkstock.git
git push -u origin main
```
(Replace `YOUR_USERNAME` with your GitHub username)

---

## PART 3 — Deploy to Vercel (your live URL)

### Step 8: Connect Vercel to GitHub
1. Go to **https://vercel.com** and sign in
2. Click **"Add New Project"**
3. Click **"Import"** next to your `sparkstock` GitHub repository
   - If you don't see it, click **"Adjust GitHub App Permissions"** and grant access
4. Vercel will auto-detect it as a Vite project — leave all settings as-is
5. Click **"Deploy"**

---

### Step 9: Wait for deployment (~2 minutes)
Vercel will build and deploy your app automatically. When it's done you'll see a green checkmark and a URL like `sparkstock.vercel.app`.

Click the URL — your app is live! 🎉

---

## PART 4 — Final setup in the app

### Step 10: Set your password
1. Open your live app URL
2. Click the 🔓 button in the top right of the header
3. Set your editing password — this is what your team will use to make changes

### Step 11: Seed your inventory
The app will start with sample data. Edit or delete those items and add your real inventory.

### Step 12: Share the URL
Send the Vercel URL to your team. Anyone can view inventory without a password. They'll need the password to edit.

---

## Keeping the app updated

Whenever you want to make changes (new features, tweaks, etc.):
1. Edit your files locally
2. Push to GitHub (or re-upload via the website)
3. Vercel automatically rebuilds and redeploys — usually takes under a minute

---

## Optional: Custom domain

If you have a domain like `makerspace.org`, you can point it to your Vercel app:
1. In Vercel → your project → **Settings → Domains**
2. Add your domain and follow the DNS instructions

---

## Troubleshooting

**"Permission denied" errors in the app?**
→ Double-check your Firestore rules in Step 3 and make sure you clicked Publish.

**App loads but data doesn't save?**
→ Check that your `firebase.js` credentials are exactly right (no extra spaces or quotes).

**Vercel build failed?**
→ Check the build log — the most common cause is a typo in `firebase.js`. Make sure all 6 fields are filled in.

**White screen / app won't load?**
→ Open your browser's developer tools (F12), check the Console tab for red error messages, and share them when asking for help.

---

## Cost summary

| Service | Free tier limits | Will you hit them? |
|---|---|---|
| Firebase Firestore | 1GB storage, 50k reads/day, 20k writes/day | Very unlikely for a makerspace |
| Vercel | 100GB bandwidth/month, unlimited deploys | Very unlikely |
| EmailJS | 200 emails/month | Likely fine |

Everything here is free for a makerspace use case.
