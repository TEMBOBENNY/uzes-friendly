# UZES Android App — Full Build Playbook

**Project:** uzes-friendly  
**Repository:** https://github.com/TEMBOBENNY/uzes-friendly  
**Date:** June 2026  
**Goal:** Build an Android APK from a Capacitor web project using GitHub Actions, with a custom UZES logo.

---

## 0. Pre-Work Issue — The Google Drive Problem

### What Happened
Your project originally lived at:
```
G:\My Drive\web\uzes
```

When you ran:
```bash
npm install @capacitor/core @capacitor/cli
```

It exploded with hundreds of lines like:
```
npm warn tar TAR_ENTRY_ERROR UNKNOWN: unknown error, write
npm warn cleanup Failed to remove some directories [
  [Error: EPERM: operation not permitted, rmdir 'G:\My Drive\web\uzes\node_modules\...']
]
npm error EBADF: bad file descriptor, write
```

### Why It Failed
**Google Drive (and any cloud-synced folder like OneDrive, Dropbox, iCloud)** instantly locks files to sync them to the cloud. npm creates, writes, and deletes **tens of thousands of tiny files** during installation. The cloud sync service grabs and locks each file the moment it appears, so npm can't write or delete them — causing `EPERM`, `EBADF`, and `TAR_ENTRY_ERROR`.

This is a **known, universal problem** with npm inside cloud-synced directories. It has nothing to do with Capacitor, Node, or your code.

### The Fix
**DeepSeek correctly diagnosed this** and told you to move the project to a **local, non-synced drive**.

You moved it to:
```
C:\Users\MECTECH\Downloads\Mobile Devices\uzes
```

After moving, the npm installation succeeded.

> ⚠️ **Important note:** You mentioned moving the project back to Google Drive after fixing the app. This is **not recommended** for active development. Keep the project on a local drive. If you need cloud backup, use **Git + GitHub** (which you already have), not Google Drive. You can keep source files in Drive if you must, but `node_modules/` will break every time you run `npm install` from a synced folder.

---

## 1. Background — What Failed Before

Before this session, you worked with **DeepSeek** and **ChatGPT** to set up the build pipeline. Here's what they accomplished and where they got stuck:

| AI Tool | What They Did | What Failed |
|---------|---------------|-------------|
| **DeepSeek** | Created initial GitHub Actions workflow, tried Docker containers, Node version fixes, Android SDK setup | Build never produced an APK. Workflow had invalid Gradle version, wrong Java version, and broken YML structure. |
| **ChatGPT** | Verified local Node/Capacitor versions, rewrote YAML, added named steps | Build still didn't produce APK. The workflow was half-merged, contained merge conflicts, and still had Java 17 instead of 21. |

### The Core Issues Left Behind:
- **Invalid Gradle version** (`gradle-8.14.3` — doesn't exist)
- **Wrong Java version** (`17` — Capacitor 8.x requires `21`)
- **Missing `colors.xml`** — caused AAPT build failure
- **Merge conflict** in the YML file from multiple AI edits
- **Missing `setup-java` before `npx cap sync`** — sync sometimes needs Java

---

## 2. Initial State — What I Found

When I started, your project had these files:

```
uzes-friendly/
├── .github/workflows/build-android.yml    (broken, had merge conflicts)
├── android/
│   ├── app/build.gradle                   (correct)
│   ├── app/capacitor.build.gradle         (required Java 21)
│   ├── build.gradle                       (AGP 8.13.0)
│   ├── settings.gradle                    (correct)
│   ├── variables.gradle                   (correct)
│   ├── gradle.properties                  (correct)
│   ├── gradle/wrapper/gradle-wrapper.properties  (INVALID: gradle-8.14.3)
│   └── app/src/main/res/values/           (MISSING: colors.xml)
├── package.json                           (@capacitor 8.4.1)
├── capacitor.config.json                  (webDir: public)
└── public/                                (HTML/JS website)
```

### The Project Stack:
- **Capacitor 8.4.1** (Android platform)
- **Node 22** (required by Capacitor CLI)
- **Java 21** (required by `capacitor.build.gradle`)
- **Gradle 8.14** (paired with AGP 8.13.0)
- **AGP 8.13.0** (Android Gradle Plugin)
- **compileSdk/targetSdk 36**, **minSdk 24**

---

## 3. Problem Diagnosis — The 3 Build Killers

### 🔴 Problem 1: Invalid Gradle Version

**File:** `android/gradle/wrapper/gradle-wrapper.properties`

**Broken:**
```properties
distributionUrl=https\://services.gradle.org/distributions/gradle-8.14.3-all.zip
```

**Why it failed:** Gradle version `8.14.3` does **not exist** as a release. Gradle releases are `8.14`, `8.15`, `8.14.1` max. This caused a 404 download error, so the wrapper could never bootstrap.

**Fixed:**
```properties
distributionUrl=https\://services.gradle.org/distributions/gradle-8.14-all.zip
```

---

### 🔴 Problem 2: Wrong Java Version (17 vs 21)

**File:** `.github/workflows/build-android.yml`

**Broken:**
```yaml
- uses: actions/setup-java@v4
  with:
    distribution: temurin
    java-version: 17
```

**Why it failed:** Your `android/app/capacitor.build.gradle` and `android/capacitor-cordova-android-plugins/build.gradle` explicitly set:
```gradle
compileOptions {
    sourceCompatibility JavaVersion.VERSION_21
    targetCompatibility JavaVersion.VERSION_21
}
```

Java 17 cannot compile code targeting Java 21. The Gradle build failed immediately with an unsupported class file version error.

**Fixed:**
```yaml
- uses: actions/setup-java@v4
  with:
    distribution: temurin
    java-version: 21
```

**Also:** Moved `setup-java` to **before** `npx cap sync android` because Capacitor sync sometimes invokes Java/Gradle tasks.

---

### 🔴 Problem 3: Missing `colors.xml`

**File:** `android/app/src/main/res/values/colors.xml` (didn't exist)

**Broken:** `styles.xml` referenced these colors:
```xml
<item name="colorPrimary">@color/colorPrimary</item>
<item name="colorPrimaryDark">@color/colorPrimaryDark</item>
<item name="colorAccent">@color/colorAccent</item>
```

But `colors.xml` was **missing entirely**. The Android Asset Packaging Tool (AAPT) failed with "resource not found" during the build.

**Fixed:** Created the missing file:
```xml
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="colorPrimary">#3F51B5</color>
    <color name="colorPrimaryDark">#303F9F</color>
    <color name="colorAccent">#FF4081</color>
</resources>
```

---

## 4. Fix Execution — Step by Step

### Step 1: Edit the YML workflow
**File:** `.github/workflows/build-android.yml`

Merged the best of both the local and remote versions:
- Named steps from the remote version (cleaner)
- Java 21 from our fix (required)
- `setup-java` before `npx cap sync` (correct order)
- Removed redundant `npm install @capacitor/core @capacitor/cli` (already in `package.json`)

**Final YML:**
```yaml
name: Build Android APK

on:
  workflow_dispatch:
  push:
    branches: [ main ]

jobs:
  build:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - name: Setup Java
        uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: 21

      - name: Install dependencies
        run: npm ci

      - name: Sync Capacitor (generate Android project)
        run: npx cap sync android

      - name: Grant execute permission for Gradle
        run: chmod +x android/gradlew

      - name: Build APK (Debug)
        run: |
          cd android
          ./gradlew assembleDebug

      - name: Upload APK artifact
        uses: actions/upload-artifact@v4
        with:
          name: apk-debug
          path: android/app/build/outputs/apk/debug/app-debug.apk
```

---

### Step 2: Fix Gradle wrapper version
**File:** `android/gradle/wrapper/gradle-wrapper.properties`

Changed `8.14.3` → `8.14` (a valid, existing release).

---

### Step 3: Create missing `colors.xml`
**File:** `android/app/src/main/res/values/colors.xml`

Created with default Material Design colors to satisfy AAPT.

---

### Step 4: Commit and push
```bash
git add .
git commit -m "Fix Android GitHub Actions build: Java 21, correct Gradle version, add missing colors.xml"
git push origin main
```

**Result:** ✅ Build succeeded in 1m 44s. APK artifact appeared.

---

## 5. Adding the Custom UZES Logo

### Step 1: Prepare the logo image
You provided: `Gemini_Generated_Image_6uz3676uz3676uz3.png` (974×1104, transparent PNG)

### Step 2: Generate all Android icon sizes
Generated 15 icon files across 5 densities using Python/Pillow:

| Density | Size | Files Generated |
|---------|------|-----------------|
| mdpi | 48×48 | ic_launcher.png, ic_launcher_round.png, ic_launcher_foreground.png |
| hdpi | 72×72 | ic_launcher.png, ic_launcher_round.png, ic_launcher_foreground.png |
| xhdpi | 96×96 | ic_launcher.png, ic_launcher_round.png, ic_launcher_foreground.png |
| xxhdpi | 144×144 | ic_launcher.png, ic_launcher_round.png, ic_launcher_foreground.png |
| xxxhdpi | 192×192 | ic_launcher.png, ic_launcher_round.png, ic_launcher_foreground.png |

**Icon types:**
- **Square (`ic_launcher.png`)**: White background, centered logo
- **Round (`ic_launcher_round.png`)**: White circular background with logo, masked to circle
- **Foreground (`ic_launcher_foreground.png`)**: Transparent background, for adaptive icons on Android 8.0+

### Step 3: Update icon background color
**File:** `android/app/src/main/res/values/ic_launcher_background.xml`

Changed from white (`#FFFFFF`) to UZES brand blue (`#003399`) to match the logo.

### Step 4: Commit and push
```bash
git add android/app/src/main/res/
git commit -m "Replace app icons with UZES logo"
git push origin main
```

**Result:** ✅ New GitHub Actions run triggered automatically. Build succeeded. New APK with UZES logo available.

---

## 6. How to Download the APK

1. Go to **GitHub → Actions → Build Android APK**
2. Click the latest run (the one with the green ✅ checkmark)
3. Scroll to the **Artifacts** section at the bottom
4. Click **`apk-debug`** to download a ZIP file
5. Unzip the file — inside is **`app-debug.apk`**
6. Transfer to your Android phone and install

**Important:** If the old icon still shows after installing, **uninstall the old app first** (Android launcher caches icons).

---

## 7. Final Working Project Structure

```
uzes-friendly/
├── .github/workflows/build-android.yml      ← Clean, working workflow
├── android/
│   ├── app/
│   │   ├── build.gradle                      ← Capacitor 8 app config
│   │   ├── capacitor.build.gradle            ← Requires Java 21
│   │   └── src/main/res/
│   │       ├── mipmap-mdpi/                  ← UZES logo (48×48)
│   │       ├── mipmap-hdpi/                  ← UZES logo (72×72)
│   │       ├── mipmap-xhdpi/                 ← UZES logo (96×96)
│   │       ├── mipmap-xxhdpi/                ← UZES logo (144×144)
│   │       ├── mipmap-xxxhdpi/               ← UZES logo (192×192)
│   │       ├── mipmap-anydpi-v26/            ← Adaptive icon XML
│   │       ├── values/
│   │       │   ├── colors.xml                ← App theme colors
│   │       │   ├── ic_launcher_background.xml ← UZES blue #003399
│   │       │   ├── strings.xml               ← App name: "uzes-friendly"
│   │       │   └── styles.xml                  ← App themes
│   │       └── drawable/                     ← Splash screen images
│   ├── build.gradle                           ← AGP 8.13.0
│   ├── settings.gradle                        ← Project includes
│   ├── variables.gradle                       ← SDK versions (min=24, target=36)
│   ├── gradle.properties                      ← AndroidX enabled
│   └── gradle/wrapper/
│       └── gradle-wrapper.properties          ← Gradle 8.14 (valid)
├── capacitor.config.json                      ← appId: com.uzes.app, webDir: public
├── package.json                               ← @capacitor 8.4.1
└── public/                                    ← HTML/JS website files
```

---

## 8. Key Lessons Learned

| Lesson | Why It Matters |
|--------|----------------|
| **Always match Java version to Capacitor requirements** | Capacitor 8.x requires Java 21. Using Java 17 fails the build. |
| **Verify Gradle versions exist** | `gradle-8.14.3` doesn't exist. Always check https://services.gradle.org/distributions/ for valid versions. |
| **Missing Android resources break the build** | AAPT needs every referenced file. If `colors.xml` is missing, the build halts. |
| **Order of operations in CI matters** | `setup-java` should run before `npx cap sync` because sync may invoke Gradle/Java tasks. |
| **Multiple AIs editing the same file creates merge conflicts** | DeepSeek and ChatGPT both edited the YML remotely, causing a Git conflict we had to resolve. |
| **Uninstall old APK before testing new icons** | Android launchers cache app icons. Installing over an old app won't show the new icon. |

---

## 9. Summary of All Files Changed

| File | Action | Why |
|------|--------|-----|
| `.github/workflows/build-android.yml` | Edited + Merged | Fixed Java 21, ordered steps correctly, resolved merge conflict |
| `android/gradle/wrapper/gradle-wrapper.properties` | Edited | Fixed invalid Gradle 8.14.3 → 8.14 |
| `android/app/src/main/res/values/colors.xml` | Created | Fixed missing color resources causing AAPT error |
| `android/app/src/main/res/mipmap-mdpi/ic_launcher.png` | Replaced | UZES logo |
| `android/app/src/main/res/mipmap-mdpi/ic_launcher_round.png` | Replaced | UZES logo |
| `android/app/src/main/res/mipmap-mdpi/ic_launcher_foreground.png` | Replaced | UZES logo |
| `android/app/src/main/res/mipmap-hdpi/ic_launcher.png` | Replaced | UZES logo |
| `android/app/src/main/res/mipmap-hdpi/ic_launcher_round.png` | Replaced | UZES logo |
| `android/app/src/main/res/mipmap-hdpi/ic_launcher_foreground.png` | Replaced | UZES logo |
| `android/app/src/main/res/mipmap-xhdpi/ic_launcher.png` | Replaced | UZES logo |
| `android/app/src/main/res/mipmap-xhdpi/ic_launcher_round.png` | Replaced | UZES logo |
| `android/app/src/main/res/mipmap-xhdpi/ic_launcher_foreground.png` | Replaced | UZES logo |
| `android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png` | Replaced | UZES logo |
| `android/app/src/main/res/mipmap-xxhdpi/ic_launcher_round.png` | Replaced | UZES logo |
| `android/app/src/main/res/mipmap-xxhdpi/ic_launcher_foreground.png` | Replaced | UZES logo |
| `android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png` | Replaced | UZES logo |
| `android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_round.png` | Replaced | UZES logo |
| `android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png` | Replaced | UZES logo |
| `android/app/src/main/res/values/ic_launcher_background.xml` | Edited | Changed to UZES brand blue #003399 |

**Total files changed:** 19  
**Build status:** ✅ **SUCCESS** — APK produced with custom UZES logo.

---

*End of Playbook*
