# Pool Link

A fast control surface for your iAqualink pool and spa.

Pool Link is an installable web app (PWA) that talks to Jandy's iAqualink APIs
straight from the browser — no server of your own, no account beyond the one
you already use in the iAqualink app. Sign in and you get your pumps, heaters,
lights, aux relays, one-touch macros, schedules, chemistry readings, and pump
setup, all on one screen that loads instantly and works from your phone at the
poolside.

Your password is never stored: signing in exchanges it for a refresh token that
lives in the browser's own storage, on your device only.

## Run it locally

Install [Bun](https://bun.sh), then:

```bash
git clone https://github.com/daveycodez/pool-link.git
```

```bash
cd pool-link && bun install && bun run dev
```

The dev server binds to every interface, so it prints a **Network** URL
alongside the local one:

```
➜  Local:   http://localhost:3000/
➜  Network: http://192.168.1.42:3000/
```

Open that Network URL on any phone or tablet on the same Wi‑Fi to use the app
there — including "Add to Home Screen", which installs it like a native app.

## Scripts

| Command | What it does |
| --- | --- |
| `bun run dev` | Dev server on port 3000, reachable across your LAN |
| `bun run build` | Static build into `dist/client` |
| `bun run preview` | Serve the build locally |
| `bun run check` | Biome lint + format check |
| `bun run icons` | Regenerate app icons from `public/icon-*.svg` |

## Deploying

Pushing to `main` builds and publishes to GitHub Pages via
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml). The build is
entirely static, so any static host works — set `BASE_PATH` if you serve it
from a subdirectory.

## Built with

[TanStack Start](https://tanstack.com/start) (SPA mode) and
[Router](https://tanstack.com/router), [TanStack Query](https://tanstack.com/query),
[HeroUI](https://heroui.com), [Tailwind CSS](https://tailwindcss.com), and
[Biome](https://biomejs.dev).

## Credits

The iAqualink protocol layer in `src/lib/aqualink/` is a TypeScript port of
[flz/iaqualink-py](https://github.com/flz/iaqualink-py), used under the BSD
3-Clause License — see [NOTICE](NOTICE).

Not affiliated with, endorsed by, or supported by Zodiac Pool Systems, Jandy,
or Fluidra. iAqualink is their trademark.

## License

[MIT](LICENSE)
