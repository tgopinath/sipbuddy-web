# SipBuddy for the web, Android and Windows

The same product as the native Mac app (`~/Documents/SipBuddy`, repo tgopinath/SipBuddy): a friendly water reminder that only goes away once the camera sees you drinking. Plain HTML, CSS and JavaScript on the Kolam design system, no build step.

## Files
- `index.html`, `app.css`, `app.js`: Today (ring and filling drop, Drink now, next reminder with pause and snooze, today's sips with edit and delete), Statistics (week and month chart, streak, 30-day average, best day, CSV export) and Settings (goal, water per sip, schedule, personality, camera, appearance, data).
- `messages.js`: the Mac app's 70 messages, 4 personalities and greetings, verbatim.
- `planner.js`: a port of `ReminderPlanner.swift` (working days, weekend hours, lunch, sleep, stop at goal, snooze, pause, one catch-up after sleep).
- `detector.js`: on-device drinking detection with MediaPipe Tasks (Face Landmarker, Hand Landmarker, EfficientDet-Lite0 Object Detector for bottle, cup and wine glass). A sip = drinkware at the owner's mouth with a hand there, held 0.6 s; steady drinking adds one every 1.5 s. Five sips close a reminder.
- `sw.js`: offline copy; caches the MediaPipe runtime and models after first use; opens a reminder from a notification click.
- `kolam/`: Kolam tokens and components, plus the M3 kit (Android app) and iOS kit (iPhone home-screen app). Preview with `?app=android|ios|web`.

`?demo` loads sample history without saving (used for screenshots). `?open=reminder` opens a reminder at once.

## Limitations compared with the Mac app
- No throat-movement (optical flow) swallow counting: sips are counted from drinkware and a hand at the mouth.
- Owner recognition is a face-geometry signature from Face Landmarker landmarks, not a face-recognition embedding. It tells people apart at a desk reasonably well but can be fooled by similar faces and is not security.
- Reminders fire only while the app or tab is open (a background tab gets a system notification where the browser allows). No full-screen takeover when the app is closed, and no multi-monitor cover.
- The Android WebView cannot show web notifications, so the Android app shows reminders only while it is open.
- The first camera use downloads about 16 MB of models from Google's model storage and jsDelivr; they are cached afterwards. Video never leaves the device.

## Run locally
`python3 -m http.server 5370` (launch config "sipbuddy-web"), then http://localhost:5370. Camera access needs localhost or HTTPS.
