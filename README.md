# Life Journal

A self-hosted, customizable life documentation tool. Track your daily life with fully configurable fields, sections, and layouts.

## Features

- **Fully Customizable** — Create your own fields, sections, and layouts
- **Sub-fields** — Nest fields under parent fields (e.g., sub-topics under a person)
- **Side-by-Side** — Place fields next to each other
- **Drag & Drop** — Reorder fields in settings
- **Auto-Save** — Saves every 30 seconds when you have content
- **Export** — Download entries as TXT or PDF (via print dialog)
- **Date Navigation** — Browse past entries with year filter and sort
- **Self-Hosted** — Your data stays on your server in simple JSON files
- **Historical Accuracy** — Field names preserved as they were when entries were created

## Quick Start

### Using Docker Compose (Recommended)

```bash
git clone https://github.com/yourusername/life-journal.git
cd life-journal
docker-compose up -d
```

Access at: `http://localhost:49182`

### Manual Docker

```bash
docker build -t life-journal .
docker run -d -p 49182:49182 -v $(pwd)/data:/app/data --name life-journal life-journal
```

### Development (no Docker)

```bash
npm install
npm start
```

## File Structure

```
life-journal/
├── Dockerfile
├── docker-compose.yml
├── package.json
├── server.js          # Express API server
├── .gitignore
├── .dockerignore
├── README.md
├── public/
│   └── index.html     # Complete React frontend (single file)
└── data/              # Mounted volume (created automatically)
    └── entries/       # Journal entries as JSON files
```

## Configuration

### Changing the Port

Edit `docker-compose.yml` and change both occurrences of `49182`:

```yaml
ports:
  - "YOUR_PORT:YOUR_PORT"
environment:
  - PORT=YOUR_PORT
```

### Data Persistence

Journal entries are stored as JSON files in `/app/data/entries/`. Field and section configuration is stored in your browser's localStorage.

**Important**: Mount the `/app/data` volume to persist your entries across container restarts.

## API Endpoints

- `GET /api/storage/list?prefix=journal:` — List all entries
- `GET /api/storage/get/:key` — Get specific entry
- `POST /api/storage/set` — Save entry `{ key, value }`
- `DELETE /api/storage/delete/:key` — Delete entry
- `GET /health` — Health check

## Backup

```bash
# From Docker
docker cp life-journal:/app/data ./backup

# Or if using volume mount
cp -r ./data ./backup
```

## License

MIT
