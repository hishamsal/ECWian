# 🎓 ECWian: Attendance Companion

**Unofficial mobile app for Ethiraj College for Women students**  
A production React Native app solving daily attendance tracking and exam planning for 100+ classmates.

## 📱 Screenshots

| Login Screen | Dashboard with Progress Rings | Exam Planner |
|:---:|:---:|:---:|
| ![Login](./screenshots/login.png) | ![Dashboard](./screenshots/dashboard.png) | ![Exams](./screenshots/exams.png) |

*(Add your screenshots in a `screenshots/` folder)*

## 🎯 The Problem

The official college portal (iBoss EMS) is a legacy ExtJS web application with:
- No mobile app
- Slow, clunky interface
- No skip-limit calculations
- No exam tracking
- Poor mobile UX

Students had to open the slow website every time and manually calculate attendance buffers.

## 💡 The Solution

A clean, fast React Native app that:
- ✅ **Auto-syncs attendance** via hidden WebView + API spy
- ✅ **Progress rings** show attendance at a glance with color-coded status
- ✅ **Skip calculator** tells you exactly how many classes you can miss
- ✅ **Exam planner** for CA1, CA2, and Semester exams with countdown timers
- ✅ **Smart session handling** survives app restarts and edge-case logouts
- ✅ **Dark mode**, subject renaming, shortage alerts
- ✅ **Offline-first** with AsyncStorage

## 🛠️ Tech Stack

- **Frontend:** React Native, Expo SDK 57
- **State Management:** React Hooks (useState, useCallback, useRef)
- **Storage:** AsyncStorage (on-device only — no backend servers)
- **UI Components:** Custom-built (no heavy UI library)
- **Build System:** EAS Build with custom Android manifest plugin
- **Architecture:** Hidden WebView bridge pattern

## 🧠 Interesting Technical Challenges Solved

### 1. Reverse-Engineering Legacy ExtJS Portal
The college uses a 15-year-old ExtJS framework with hidden security tokens and non-standard form submission. Built a **4-strategy login engine**:
1. Direct POST with all form fields (visible + hidden tokens)
2. ExtJS component setValue + fireEvent
3. Native form.submit()
4. Plain button click

Each strategy verifies the session before trying the next.

### 2. Android Cleartext HTTP Blocking
The college portal uses plain HTTP. Android blocks non-encrypted connections by default. Built a **custom Expo config plugin** (`plugins/withCleartext.js`) that injects `android:usesCleartextTraffic="true"` into the Android manifest at build time.

### 3. Session Survivor Detection
Handles edge cases where logout didn't fully complete or the app was force-closed mid-session. The ghost-hand probes for an existing session and slides into the dashboard if still authenticated.

### 4. Safe-Area Navigation Handling
Custom implementation using `react-native-safe-area-context` to handle both 3-button and gesture navigation on Android devices. Tab bars, headers, and modals all respect the system insets.

### 5. Real-Time Attendance Calculations
Mathematical formulas for:
- **Skip limit:** `skipCount = floor(attended / required - total)`
- **Recovery needed:** `needed = ceil((required * total - attended) / (1 - required))`
- **Future projections:** Attendance after attending/skipping N classes

## 📦 Project Structure

ECWian/
├── App.js # Main app (all components + logic)
├── app.json # Expo configuration
├── eas.json # EAS Build profiles
├── plugins/
│ └── withCleartext.js # Custom Android manifest plugin
├── assets/
│ ├── icon.png # App icon
│ └── splash-icon.png # Splash screen icon
└── screenshots/ # App screenshots


## 🚀 Getting Started

```bash
# Clone the repository
git clone https://github.com/hishamsal/ECWian.git
cd ECWian

# Install dependencies
npx expo install

# Start development server
npx expo start

# Build APK
eas build --platform android --profile preview

# Build production AAB
eas build --platform android --profile production

📊 Live Usage
Users: 100+ daily active students
Campus: Ethiraj College for Women, Chennai
Use cases: Daily attendance tracking, exam planning, skip calculations
🔐 Privacy & Security
Credentials are entered directly into the college portal's secure WebView
No credentials are stored in the app or transmitted anywhere except the college server
Attendance data is cached locally using AsyncStorage
No ads, no tracking, no analytics
No backend servers — fully client-side
📜 Disclaimer
Unofficial student-made app. Not affiliated with, endorsed by, or connected to Ethiraj College for Women or Apple G Web Technology Pvt. Ltd. (iBoss EMS).
Built to solve a real problem for real students.
🤝 Contributing
This is a personal project, but feel free to:
Open issues for bugs or feature requests
Fork and adapt for your own college
Suggest improvements via pull requests
📝 License
MIT License - see LICENSE file for details
Built with ❤️ by Hisham Salim
ECSE Student | Mobile Developer
