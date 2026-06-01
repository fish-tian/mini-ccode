# MiniVote

MiniVote is a small full-stack voting app generated as a mini-ccode practice task. It is included as a public example of what the agent can build with file tools, command approval, and iterative verification.

## Features

- View all polls.
- Create a poll with multiple options.
- Vote once per poll using a cookie-based voter token.
- View results only after voting.
- Share poll links.
- React + Vite frontend with a clean Apple-inspired interface.
- Bun API server with SQLite via `bun:sqlite`.

## Run

```bash
bun install
bun run seed
bun run dev
```

Open:

```text
http://localhost:5173
```

The API server runs at:

```text
http://localhost:3000
```

## Scripts

```bash
bun run dev        # start API server and Vite dev server
bun run dev:server # start only the Bun API server
bun run dev:client # start only the Vite client
bun run seed       # create demo polls in local SQLite
bun run build      # build the React frontend
bun run start      # start the API server
```

## Data

The app creates a local SQLite database named `minivote.db`. Database files are ignored by Git.

## Structure

```text
examples/minivote/
  docs/         generation history and screenshot
  server/       Bun API server and SQLite access
  src/          React frontend
  index.html    Vite entry
  package.json  scripts and dependencies
```

## Generation History

The `docs/history.md` file records the mini-ccode interaction that produced this example. Local absolute paths have been replaced with `<workspace>` before publishing.
