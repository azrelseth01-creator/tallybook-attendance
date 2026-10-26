# Tallybook

A class attendance register for teachers. Mark each student present, absent, late or excused, watch their absence tally grow, and see everything on a calendar, in reports and on a printable monthly register.

It is a plain static site (no build step, no dependencies) plus three tiny serverless functions, so it deploys to Vercel in about a minute.

## Features

- **Today**: card, list or seating-chart view. Tap a status and a rubber stamp lands on the card, with sound and an ink splat. Keyboard shortcuts (P, A, L, E) for fast marking.
- **Guided roll call**: one student at a time with big buttons. Optionally reads each name aloud.
- **Absence tally**: hand-drawn tally marks and a count on every student, with a warning at the limit you choose. Lates can add up to absences.
- **Roster**: type names in, or paste a whole class list. Per-student icon and colour, or an uploaded photo (up to 10 MB, cropped and shrunk to a small square), guardian contact, notes, archive, drag to reorder.
- **Calendar**: attendance rate per day, no-class days and breaks, and a side panel for who was away.
- **Reports**: charts, watch list (at the limit, getting close, absent in a row, perfect attendance), a printable monthly register and CSV export. JSON backup and restore live in Settings.
- **Class library**: the Classes tab shows every class as a book on a shelf, with your teacher name and profile photo. Search and filter, sort into groups (folders such as a grade or a subject), favorite, archive, drag a book onto a group, and give any class its own optional password.
- **Several classes**, a day note (sticky note), undo, and a student profile with a 14-week heat map.
- **Settings**: customize your teacher display name and profile photo, school details, school days, attendance rules, desk colour, paper style, text size, sound and effects, backup and restore. Manage classes from the Classes tab or the title-bar picker.
- **Optional background music**: paste YouTube, Spotify or .mp3 links. It is off by default; the dock can shuffle through every queued item once before reshuffling, or repeat the current item or whole queue.
- **Loading screen**: a short intro and lightweight transition screen while startup or class navigation completes. It no longer holds the app for an artificial minimum wait.
- **Password screen**: the first thing you see. Two passwords: a normal one (view only) and an admin one (can edit). Use Show/Hide to check what you typed; the screen also warns when Caps Lock is on. See *Sign-in and access levels* below.
- **Optional**: cloud sync across devices, installable as an app, works offline once opened.

## Project layout

```
tallybook/
  public/                  <- everything the browser loads (Vercel's output directory)
    index.html
    manifest.webmanifest, sw.js
    assets/
      css/                 tokens (colours, fonts) -> base -> shell -> components -> views -> print
      icons/               favicon + app icons
      js/
        main.js            start-up, router, title bar, cover and PIN
        core/              store (data + undo + saving), stats (all the counting), dates, config, sample data
        services/          audio (sound effects), vfx (particles), music (YouTube/Spotify), sync (cloud)
        ui/                dialogs, toasts, avatars, tally marks, profile drawer, music toolbar, loading screen (loader.js)
        views/             today, rollcall, roster, calendar, reports, settings
  api/                     serverless functions: config.js, auth.js, sync.js
  lib/env.js               helpers shared by the functions
  scripts/dev.mjs          local dev server (no install needed)
  vercel.json, package.json, .env.example
```

To change a look, edit `public/assets/css/tokens.css` (colours, fonts) first. To change how absences are counted, edit `public/assets/js/core/stats.js`. Each page is one file in `views/`.

## Deploy to Vercel

1. Put this folder in a Git repository and push it to GitHub (or run `npx vercel` in the folder).
2. In Vercel choose **Add New, Project**, import the repository, and leave every build setting as it is. `vercel.json` already tells Vercel to serve `public/` and run `api/`.
3. Set unique `NORMAL_PASSWORD` and `ADMIN_PASSWORD` values under **Settings, Environment Variables** before deployment. Add any optional environment variables you need, then redeploy.

Every `git push` after that updates the site.

## Environment variables

Branding, music, and sync values are optional. `NORMAL_PASSWORD` and `ADMIN_PASSWORD` are required for sign-in; copy `.env.example` to `.env` and set two different passwords for local work.

| Variable | What it does |
| --- | --- |
| `APP_NAME` | Name on the cover and browser tab (default Tallybook). |
| `SCHOOL_NAME`, `TEACHER_NAME`, `ACADEMIC_YEAR`, `TERM_NAME` | Fill in the General settings for a brand-new book. |
| `CLASS_NAME` | Name of the first class. |
| `ABSENCE_ALERT_THRESHOLD` | Flag a student at this many absences (default 5). |
| `LATE_TO_ABSENCE` | This many lates count as one absence (default 3, 0 = never). |
| `DEFAULT_MUSIC_URLS` | YouTube / Spotify / .mp3 links, separated by commas, to start the queue with. |
| `NORMAL_PASSWORD` | Required view-only password. Checked on the server. |
| `ADMIN_PASSWORD` | Required admin password, different from the view-only password. Checked on the server. |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Turns on cloud sync. Create a free Redis database at upstash.com (or add Upstash from the Vercel Marketplace). `KV_REST_API_URL` and `KV_REST_API_TOKEN` also work. |

Environment variables only **seed** a new book. Anything changed later in Settings is saved in the browser and wins.

## Sign-in and access levels

The cover is a password screen with a Show/Hide control. Nothing in the book (no tab, no class, no link typed into the address bar) opens until a password is accepted. The two passwords are checked by `/api/auth`; configured password values are not embedded in browser code or returned by the public configuration endpoint. There are no built-in defaults: set unique `NORMAL_PASSWORD` and `ADMIN_PASSWORD` values in Vercel and keep them out of your repository.

| | Normal password (view only) | Admin password |
| --- | --- | --- |
| Open every tab (Classes, Today, Roster, Calendar, Reports, Settings) | Yes | Yes |
| Open classes that have their own password | Yes, without typing it | Yes, but each class password is still asked for |
| Mark attendance, roll call, notes, no-class days, breaks | No | Yes |
| Add, edit, delete, reorder students | No | Yes |
| Add, edit, delete, group, archive or lock classes | No | Yes |
| Settings (school details, rules), restore, reset, cloud save | No | Yes |
| Look and sound (desk colour, text size, sound, music playback), download backups and CSV reports | Yes | Yes |

A **Lock** button (top bar, and in the class library) signs out and returns to the password screen. Closing the tab also signs out. Editing is refused inside the data layer (`core/store.js`), not only by hiding buttons, and the cloud-sync endpoint refuses saves from the view-only password.

These passwords keep casual visitors out of the app. They do not encrypt what the browser stores, and the browser-only view-only role can be changed with developer tools. Do not use this client-side role as protection for sensitive student data. Signing in needs an internet connection, because the check happens on the server.

## Where the data lives

Attendance and your teacher display name and photo are saved in the browser on the device you use, so they keep working without internet. Download a backup from **Settings, Data and backup** every so often, because clearing browser data erases them. To keep one copy across a phone, tablet and laptop, turn on cloud sync with the two Upstash variables above. Sync keeps the latest copy (last write wins), so avoid editing on two devices at the same moment.

## Run it locally

```
node scripts/dev.mjs
```

Open http://localhost:3000. No `npm install` is needed. (`npx vercel dev` also works.)

## Music notes

- YouTube: videos and playlists. Paste a playlist page link, or a video link that has `list=` in it (including youtu.be share links). Next and Previous move through the playlist's videos, and a blocked video is skipped on its own. Private playlists and auto-made Mixes (list starting with RD) will not play.
- Spotify: tracks, albums, playlists, podcasts. Spotify controls its own volume, and plays full songs only when the browser is signed in to Spotify (otherwise 30 second previews).
- Direct audio links (.mp3, .ogg, .wav) play in a plain audio player.
- Browsers block sound until you tap or press a key once, so "Start playing on my first tap" begins on that first interaction. The dock has Shuffle and Repeat controls; Repeat cycles through queue, current item, and off. For a Spotify album or playlist, use the Spotify player controls to shuffle or repeat tracks inside that playlist.

## Class library and class passwords

- The **Classes** tab (top of the left tabs) opens the library. With more than one class, the app starts there.
- **Groups** are folders. Make one with the + next to Groups, or while creating a class. Drag a book onto a group in the sidebar, or use the book's menu, Move to a group.
- **Favorites** and **Archived** are lists. Archived classes are hidden from the class picker but keep all their records.
- A **password** is optional per class (book menu, Add a password, or while creating the class; admin only). Opening a locked class from the library, the class picker or Settings asks for it (the view-only sign-in skips this), and going back to the library locks everything again. Typing the address of a locked class sends you to the library.
- Passwords are stored only as a salted PBKDF2 hash, and a hint can be shown on the lock screen. There is no recovery for a forgotten password, so keep a backup. A password keeps others out of the app; it does not encrypt the data in the browser, in backup files or in cloud sync. Passwords need https or localhost.

## Profile and student photos

In **Settings, Your profile**, set the teacher display name and upload a profile picture. Drag and zoom to crop it; the 256 px copy is saved with the class book and appears in the Classes area. It is included in backups and optional cloud sync.

For a student, open them from Roster, choose Edit, then **Upload photo**. Their cropped photo is stored with the student record. With many photos, the cloud sync limit (about 900 KB) can be reached.

## Notes

- Fonts (Bricolage Grotesque, Schibsted Grotesk, Caveat) load from Google Fonts, and fall back to system fonts if offline.
- Sound effects are generated in the browser, so there are no audio files to host.
