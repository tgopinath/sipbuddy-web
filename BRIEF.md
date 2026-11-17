# SipBuddy web: brief

**Problem.** People forget to drink water at a desk, and ordinary reminders are dismissed without drinking.
**User.** Someone who works at a computer or phone most of the day, on Windows, Android or iPhone, where the native Mac app can't run.
**Jobs to be done.** Be nudged at sensible times; prove the sip happened without typing anything; see whether the day's goal is on track.

**v1 screens.** Today; full-screen reminder with the camera; Drink now; Statistics; Settings (including Learn my face).
**Data.** Local only (localStorage). MediaPipe Tasks models (Google, Apache 2.0), loaded from storage.googleapis.com and cdn.jsdelivr.net.
**Success.** A reminder closes after 5 counted sips of the owner; nothing is uploaded; works at 375 px and on desktop, light and dark, keyboard and screen reader.
**Out of scope.** Accounts and sync, throat tracking, reminders while the app is closed, units other than ml.
