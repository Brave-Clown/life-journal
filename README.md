# Life Journal

A self-hosted, password-protected life documentation tool. Track your daily life with fully configurable fields, sections, and layouts.

## Features

- **Password Protected** — Optional login with rate-limited authentication
- **Fully Customizable** — Create your own fields, sections, and layouts
- **Sub-fields** — Nest fields under parent fields
- **Side-by-Side** — Place fields next to each other
- **Drag & Drop** — Reorder fields in settings
- **Auto-Save** — Saves every 30 seconds when you have content
- **Export** — Download entries as TXT or PDF
- **Date Navigation** — Browse past entries with year filter and sort
- **Self-Hosted** — Your data stays on your server in simple JSON files
- **Security Hardened** — CSP headers, no CORS, HttpOnly cookies, path traversal protection

## Quick Start

### Docker Compose

```bash
git clone https://github.com/Brave-Clown/life-journal.git
cd life-journal
docker-compose up -d
```

Access at `http://localhost:49182`

### With Password Protection (Automatic)

On first launch, the app shows a **setup screen** requiring you to create a password before anything else. There's no default password and no way to skip this step — your journal is protected from the start.

The password is stored as a salted hash in your data directory (`/app/data/auth.json`), not in plaintext.

You can optionally override with an environment variable (useful for automation):

```yaml
environment:
  - JOURNAL_PASSWORD=your-override-password
```

If `JOURNAL_PASSWORD` is set in the environment, it takes precedence over the stored password.

## TrueNAS Scale Deployment

### 1. Create a Dataset

Create a dedicated ZFS dataset for your journal data:

1. TrueNAS Web UI → **Datasets** → Select your pool → **Add Dataset**
2. Name: `life-journal` (or whatever you prefer)
3. Leave defaults, click **Save**
4. Set permissions: **Owner** `apps:apps`, **Read | Write | Execute**

This gives you ZFS snapshots, quotas, and replication for your journal data independently.

**Recommended**: Set up a periodic snapshot task (Data Protection → Periodic Snapshot Tasks) for daily snapshots with 30-day retention.

### 2. Build and Run

SSH into TrueNAS:

```bash
cd /tmp
git clone https://github.com/Brave-Clown/life-journal.git
cd life-journal
sudo docker build -t life-journal .
sudo docker run -d --name life-journal \
  --restart unless-stopped \
  -p 49182:49182 \
  -v /mnt/tank/apps/life-journal:/app/data \
  -e NODE_ENV=production \
  -e PORT=49182 \
  life-journal
```

Replace `/mnt/tank/apps/life-journal` with your actual dataset path. On first visit, you'll be prompted to create a password.

### 3. Verify Dataset Is Being Used

```bash
# Check the mount
sudo docker inspect life-journal | grep -A5 Mounts

# Check files exist
ls -la /mnt/tank/apps/life-journal/entries/
```

### Portainer (Alternative)

If you built the image via CLI, create a Stack in Portainer with:

```yaml
version: '3.8'
services:
  life-journal:
    image: life-journal
    container_name: life-journal
    ports:
      - "49182:49182"
    volumes:
      - /mnt/tank/apps/life-journal:/app/data
    environment:
      - NODE_ENV=production
      - PORT=49182
    restart: unless-stopped
```

## Reverse Proxy Setup

If exposing to the internet, always use a reverse proxy with HTTPS. Example Nginx config:

```nginx
server {
    listen 443 ssl;
    server_name journal.yourdomain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:49182;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

If using Cloudflare Tunnel, point it to `http://localhost:49182`.

**Important**: Always set `JOURNAL_PASSWORD` when exposing to the internet.

## Security

- **Mandatory Password Setup**: First-run wizard forces password creation — no defaults, no skipping
- **Hashed Storage**: Passwords stored as salted scrypt hashes, never plaintext
- **Rate Limiting**: Login locked for 15 minutes after 5 failed attempts
- **Timing-Safe Comparison**: Password check uses constant-time comparison
- **Security Headers**: CSP, X-Frame-Options (DENY), X-Content-Type-Options, Referrer-Policy
- **No CORS**: API only accepts same-origin requests
- **HttpOnly Cookies**: Session tokens inaccessible to JavaScript
- **Path Traversal Protection**: Storage keys are sanitized and path-verified
- **Non-Root Container**: Runs as UID 568 (matches TrueNAS `apps` user)
- **HTML Sanitization**: PDF export escapes all user content
- **Password Change**: Available in-app (requires current password)

## File Structure

```
life-journal/
├── Dockerfile
├── docker-compose.yml
├── package.json
├── server.js              # Express API + auth
├── .gitignore
├── .dockerignore
├── README.md
├── public/
│   └── index.html         # Complete React frontend
└── data/                   # Mounted volume
    └── entries/            # Journal entries (JSON)
```

## API Endpoints

**Public:**
- `POST /api/login` — Authenticate `{ password }`
- `POST /api/logout` — End session
- `GET /api/auth-status` — Check auth state
- `GET /health` — Health check

**Protected (requires session):**
- `GET /api/storage/list?prefix=journal:` — List entries
- `GET /api/storage/get/:key` — Get entry
- `POST /api/storage/set` — Save entry `{ key, value }`
- `DELETE /api/storage/delete/:key` — Delete entry

## Updating

```bash
cd /tmp/life-journal
git pull
sudo docker build --no-cache -t life-journal .
sudo docker stop life-journal && sudo docker rm life-journal
sudo docker run -d --name life-journal \
  --restart unless-stopped \
  -p 49182:49182 \
  -v /mnt/tank/apps/life-journal:/app/data \
  -e NODE_ENV=production \
  -e PORT=49182 \
  life-journal
```

Your journal data and password are in the ZFS dataset and are never affected by rebuilds.

## Troubleshooting

### Locked Out / Forgot Password

Delete the auth file and restart — you'll get the setup screen again:

```bash
sudo rm /mnt/tank/apps/life-journal/auth.json
sudo docker restart life-journal
```

### Delete Button Not Working

The entry must be saved to the server first. If you just typed into fields without clicking Save, there's nothing on the server to delete. Save the entry first, then delete.

### Container Shows "Unhealthy" in Portainer

This is normal if the healthcheck interval hasn't passed yet. If you can access the journal in your browser, the app is working fine.

## Backup

```bash
# Snapshot (ZFS — instant, zero-downtime)
zfs snapshot tank/apps/life-journal@backup-$(date +%Y%m%d)

# Or manual copy
cp -r /mnt/tank/apps/life-journal/entries/ ./backup/
```

## Multiple Users

Each person needs their own instance. Run additional containers on different ports with separate data directories:

```bash
# Your journal (port 49182)
sudo docker run -d --name journal-me -p 49182:49182 \
  -v /mnt/tank/apps/life-journal-me:/app/data life-journal

# Daughter's journal (port 49183)
sudo docker run -d --name journal-daughter -p 49183:49182 \
  -v /mnt/tank/apps/life-journal-daughter:/app/data life-journal
```

Each instance prompts for its own password on first visit, and has completely separate data and field configuration.

## License

MIT
