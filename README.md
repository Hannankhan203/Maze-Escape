# Maze Escape

A browser-based maze game built with React and Vite.

## Technology Stack

- **UI Library:** React 19 (`react`, `react-dom`)
- **Build Tool & Dev Server:** Vite 8 (`@vitejs/plugin-react`)
- **Language:** JavaScript (ES Modules, JSX)
- **Styling:** Plain CSS (`src/styles/global.css`)
- **Linting:** ESLint 10 (`@eslint/js`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`)

## Prerequisites

- **Node.js** (v18+ or v20+ / v22+ recommended)
- **npm** (included with Node.js)

## Installation

Install project dependencies using npm:

```bash
npm install
```

## Development Server

Start the local Vite development server:

```bash
npm run dev
```

The application runs on port `3000` (`http://localhost:3000`).

## Build & Verification

Create a production bundle in `dist/`:

```bash
npm run build
```

Run the automated test suite (20 Node engine + React DOM integration suites), linter, or preview the production build locally:

```bash
npm test
npm run lint
npm run preview
```

## Manual Browser & Device QA Checklist

Automated Node/React DOM suites run against headless mocks (`createMockWebGLRenderer`, synthetic DOM/timers). Before a public release, verify in real browsers and devices:

- **Desktop (Chrome, Firefox, Safari):**
  - Default `/` 2D gameplay loads without WebGL errors and without fetching the lazy 3D chunk until **3D Preview** is clicked.
  - Clicking **3D Preview** loads the 3D scene, updates `?view=3d`, and switches cleanly between First-Person and Third-Person cameras.
  - Pointer Lock activates on stage click, releases on `ESC`, and causes zero unhandled Promise rejections if rejected.
  - Fullscreen toggle, Web Audio unlock + Mixer sliders, Scare Director, Reduced Motion (`data-reduced-motion="true"`), and zero DevTools console errors/warnings.
  - Modals (`Game Paused`, `Settings`, `Maze Escaped`, `Claimed by the Dark`) move focus on open, trap `Tab` / `Shift+Tab`, restore trigger focus on close, and keep Victory/Game Over non-dismissible via `Escape`.
- **Mobile (`375×667` portrait & `844×390` landscape):**
  - Left thumb joystick + right touch-look pad + action/ability buttons work smoothly without HUD or minimap overlap/clipping.
  - Flashlight **Light** button toggles once per tap, does not get stuck if released outside button bounds, and responds to `Enter`/`Space`.

