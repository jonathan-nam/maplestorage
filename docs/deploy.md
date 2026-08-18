# Deploying

Production is **one Lightsail box** running `docker compose`: Caddy, the backend, the vision
service and Postgres. $12/month. The frontend is on Vercel's free tier.

```
                    Cloudflare (free tier, proxied)
                       │
   sharpeyes.gg ───────┼──> Vercel          Next frontend   (DNS-only, grey cloud)
   api.sharpeyes.gg ───┴──> Lightsail box                   (proxied, orange cloud)
                                │
                            Caddy :443      TLS, 20MB body limit
                                │
                            backend :8080 ─┐  shared network namespace:
                            vision  :8000 ─┘  the backend reaches the parser on 127.0.0.1
                                │
                            postgres + volume
                                │  nightly pg_dump
                                └──> S3
```

## First time

### 1. Domain and DNS

Register the domain wherever carries `.gg`, then move its nameservers to Cloudflare. Cloudflare
Registrar does not sell `.gg`, but its DNS is free and the proxy in front of the box is the reason
it is here at all.

| Record | Points at | Proxy |
| --- | --- | --- |
| `sharpeyes.gg` | Vercel | **DNS-only (grey cloud)** |
| `api.sharpeyes.gg` | the box's static IP | proxied (orange cloud) |

The apex must be **grey**. Cloudflare's proxy fights Vercel's own TLS, and the failure looks like a
certificate error nobody can explain.

### 2. The box

```bash
cd infra
./bootstrap-state-backend.sh              # once, ever. State holds an IAM secret key.
terraform init -backend-config=backend.hcl
terraform apply
terraform output static_ip                # -> the A record above
```

Point DNS at that IP and let it resolve **before** starting Caddy. Let's Encrypt will not issue a
certificate for a name that does not resolve to you, and failed challenges count against a rate
limit (5 per hostname per hour).

Download the SSH key from the Lightsail console, then:

```bash
ssh -i <key>.pem ubuntu@<static-ip>
```

Cloud-init installs Docker and adds `ubuntu` to the `docker` group. That group membership only
applies to a **new** login, so log out and back in once before deploying, or every docker command
says "permission denied".

### 3. Configure and deploy

```bash
git clone https://github.com/jonathan-nam/sharpeyes.git
cd sharpeyes
cp .env.prod.example .env
vi .env                    # every field. DB_PASSWORD: openssl rand -base64 32
./deploy.sh
```

`deploy.sh` builds, starts, and then polls `https://$API_DOMAIN/health` from outside, through
Caddy, over TLS. A container being "up" proves nothing: the backend crash-loops on a missing
variable, and Flyway migrates on every boot, so a bad migration surfaces here and nowhere earlier.

### 4. Frontend

On Vercel, from the repo, root directory `frontend/`:

```
NEXT_PUBLIC_API_BASE_URL=https://api.sharpeyes.gg
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_...
CLERK_SECRET_KEY=sk_live_...
```

Then add both hostnames to the Clerk dashboard's allowed origins, or every request 401s.

### 5. Backups

```bash
crontab -e
# 07:30 UTC, half an hour after the Lightsail snapshot
30 7 * * * cd /home/ubuntu/sharpeyes && ./scripts/backup-db.sh >> /var/log/sharpeyes-backup.log 2>&1
```

**Then rehearse the restore, once, before you need it** (below). An untested backup is a file you
believe is a backup.

## Deploying a change

Push to master first. `deploy.sh` pulls `--ff-only`, so it will refuse a box whose checkout has
diverged rather than merge on the box.

```bash
ssh ubuntu@<static-ip>
cd sharpeyes && ./deploy.sh
```

About 30 seconds of downtime. That is the accepted cost of one box: a rolling deploy needs
somewhere to roll to.

The backend is built **on the box**, so a deploy is a full Gradle compile on 2 vCPUs, not a pull.
Flyway then migrates on boot, which is why `deploy.sh` polls `https://$API_DOMAIN/health` from
outside instead of trusting `docker compose ps`.

Backend only, skipping the vision rebuild:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build backend
```

That one is safe. **Naming `vision` alone is not**, see below.

### Rolling back

Revert on master and deploy that, which keeps the box on a branch and CI on the thing that is
running. When it has to be faster than a PR, roll back on the box, bypassing `deploy.sh`:

```bash
git checkout <last-good-sha>     # detached HEAD
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

`deploy.sh` cannot do this. It starts with `git pull --ff-only`, which on a detached HEAD exits with
"You are not currently on a branch" before anything is built. Get the box back onto `master` before
the next deploy, or that one fails the same way.

Either route rolls back **code only**. Flyway has no down migrations, so a schema change stays
applied and an old backend then runs against a newer schema. If the bad deploy carried a migration,
restore from S3 instead (below), and take a backup *before* deploying one:

```bash
./scripts/backup-db.sh
```

Note that `R__` migrations are repeatable: they re-run whenever their checksum changes, so a catalog
edit applies on the next deploy without a new version number.

Changing `.env` needs `up -d` afterwards. It is not in git, so `deploy.sh`'s pull will not touch it,
and a running container will not pick it up.

## Restoring the database

Do this once as a rehearsal, into a scratch database, and compare row counts. The box's own
credentials are **PutObject-only**, so it cannot read its backups. Restore from a machine that can.

```bash
# From your laptop, with real AWS credentials:
aws s3 ls s3://maplestorage-backups-<account-id>/
aws s3 cp s3://maplestorage-backups-<account-id>/maplestorage-<stamp>.sql.gz .

# On the box, into a scratch database first:
gunzip -c maplestorage-<stamp>.sql.gz | \
  docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T postgres \
  psql -U maplestorage -d postgres -c 'CREATE DATABASE restore_check;' -d restore_check

# Compare. If these disagree, the backup is not a backup.
docker compose ... exec -T postgres psql -U maplestorage -d maplestorage   -c 'select count(*) from character_token;'
docker compose ... exec -T postgres psql -U maplestorage -d restore_check  -c 'select count(*) from character_token;'
```

## Rebuilding after the box dies

This is why `infra/` exists rather than a console click.

```bash
cd infra && terraform apply     # new box, same static IP
```

Then steps 3 and 5 above, plus a restore. The instance comes back **empty**: Docker and nothing
else. The static IP survives, so DNS does not change.

## Things that will bite

- **Never publish 5432 or 8000.** `docker-compose.prod.yml` unpublishes them with `ports: !reset []`,
  which is needed because Compose *merges* `ports` across files rather than replacing them. Check it
  from off the box after any compose change: `curl --max-time 5 http://<static-ip>:5432` must fail.
- **The vision service binds `127.0.0.1`** and the backend joins its network namespace. Put them on
  a normal Compose network and the backend cannot reach the parser at all: uploads fail, and nothing
  in the logs says why. This is also why Caddy proxies to `vision:8080` and not `backend:8080`.
- **Never recreate `vision` by name.** `up -d --force-recreate vision` gives vision a new namespace
  and strands the backend in the old, dead one. Measured: `docker compose ps` reports both services
  `running`, a TCP connect to the published port still succeeds, and every request returns nothing.
  Recreating the *whole project* is fine, because Compose recreates the backend along with vision,
  and so is naming `backend` alone. It is only vision-by-name that breaks, which is why `deploy.sh`
  never does it.
- **Do not shrink screenshots in the browser** to speed up uploads from far away. That is the bug
  this project exists to prevent: an OCR path that resampled its own evidence away and returned
  confident wrong counts. Uploads are 1.25-3.1 MB and that is fine.
- **Do not switch the backend to a fat jar.** Shading clobbers `META-INF/services` and silently
  breaks Flyway, which migrates on every boot. `backend/Dockerfile` says so too.
- The box needs egress to `nexon.com` (character lookups).
