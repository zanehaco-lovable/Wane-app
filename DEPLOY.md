# Wane — Deployment Guide

Two ways to run: Docker (recommended) or manual.

## 1) Docker (one command)
Prerequisites: Docker + Docker Compose.

```bash
cp .env.example .env        # then edit secrets (JWT_SECRET, CERT_SECRET, optional API keys)
docker compose up --build
```

- Web console (Admin/Teacher/Student/Agent):  http://localhost:8080
- Mobile app (full parity):                    http://localhost:8080/mobile.html
- Public certificate verify:                   http://localhost:8080/verify.html
- Voucher redeem landing:                      http://localhost:8080/redeem.html
- API:                                         http://localhost:4000/api

The database schema in `db/schema.sql` loads automatically on first boot.
The backend seeds demo data (users, levels, a course, a committee) on startup.

Demo accounts:
- admin@wane.academy / admin123
- teacher@wane.academy / teacher123
- student@wane.academy / student123
- agent@wane.academy / agent123

Stop / reset:
```bash
docker compose down          # stop
docker compose down -v        # stop + wipe database volume (fresh seed next boot)
```

## 2) Manual (no Docker)
Prereqs: Node 20+, PostgreSQL 14+.

```bash
# database
createdb wane
psql -d wane -f db/schema.sql

# backend
cd backend
cp ../.env.example .env       # set DATABASE_URL=postgresql://USER:PASS@localhost:5432/wane
npm install
npm start                     # serves API on :4000 (seeds on boot)

# frontend (any static server)
cd ../frontend
python3 -m http.server 8080   # or nginx; ensure /api proxies to backend:4000 in production
```

## Required environment variables
| Var | Required | Purpose |
|-----|----------|---------|
| DATABASE_URL | yes | Postgres connection |
| JWT_SECRET | yes | sign auth tokens — change in production |
| CERT_SECRET | yes | certificate hash pepper |
| VERIFY_BASE_URL | yes | base URL used in certificate/voucher QR links |
| AI_API_KEY | optional | enables real LLM grammar correction + exam-question drafting |
| SPEECH_API_KEY | optional | speaking-exam pronunciation scoring |
| ZOOM_* / GOOGLE_* | optional | real live-session links (else fallback links) |
| TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM | optional | real SMS voucher delivery (else deep links only) |

## Production notes
- Put the frontend behind HTTPS (terminate TLS at a load balancer or nginx).
- Set strong JWT_SECRET / CERT_SECRET and a managed Postgres with backups.
- Uploaded certificates go to the backend `/tmp/wane-uploads` by default — mount a persistent volume or switch to S3 for production.
- Scale the backend behind a reverse proxy; it is stateless except for the DB.
