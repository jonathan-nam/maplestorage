# Deploying

Production is **one Lightsail box** running `docker compose`: Caddy, the backend, the vision
service and Postgres. $12/month. The frontend is on Vercel's free tier.

```
   DNS: Namecheap BasicDNS
                       │
   sharpeyes.app ──────┼──> Vercel           Next frontend
   api.sharpeyes.app ──┴──> Lightsail box    everything else
                                │
                            Caddy :443      TLS, 20MB body limit, load balances
                                │
                            backend   :8080 ─┐ shared network namespace:
                            backend-b :8081 ─┤ the replicas reach the parser on 127.0.0.1,
                            vision    :8000 ─┘ and Caddy reaches them both at `vision:<port>`
                                │
                            postgres + volume
                                │  nightly pg_dump
                                └──> S3
```

## First time

### 1. Domain and DNS

Registered at **Namecheap** (2026-08-23), on Namecheap's own **BasicDNS**. Two A records, no CDN
and no proxy in front of anything.

*Domain List -> Manage -> Advanced DNS*. **Delete the two records Namecheap creates by default**
first, a `CNAME www -> parkingpage.namecheap.com` and a URL Redirect on `@`. Left in place they
answer for names this app also wants, and a parking page served over your own domain looks exactly
like a deploy that failed.

| Type | Host | Value |
| --- | --- | --- |
| A | `@` | the IP **Vercel shows you** when you add the domain |
| A | `api` | the box's static IP, from `terraform output static_ip` |

**Do not copy an apex IP out of a blog post, this one included.** Vercel used to hand everybody
`76.76.21.21`; newer projects draw from a pool matched to the plan, so yours may be something else
entirely. Use whatever the Vercel dashboard prints next to the domain.

An apex cannot be a CNAME (RFC 1034: nothing else may sit beside one, and an apex needs NS records),
which is why that row is an A record while a `www` would be a CNAME to `cname.vercel-dns.com`.

Cloudflare was considered and is not used. Nothing in this repo depends on it, no code reads a
Cloudflare header, and one DNS provider is one less account. What that decision gives up is worth
knowing rather than rediscovering:

- **The icon paths lose an edge cache.** `/token-icons/*` and `/digit-icons/*` are served immutable
  for a year (see the Caddyfile), so a returning browser still pays nothing, but a cold visitor
  fetches them from the box instead of from somewhere near them.
- **The box's IP is public**, and it is one 2-vCPU instance. Nothing absorbs traffic in front of it.

Neither is load-bearing at this size. Putting Cloudflare back later is a nameserver change and
turning one record orange, and the apex would have to stay **grey**: Cloudflare's proxy fights
Vercel's own TLS there, and the failure looks like a certificate error nobody can explain.

`.app` is on the HSTS preload list, so browsers refuse plain http to it before a request is even
made. That is free https enforcement and nothing here has to change for it, with one caveat worth
knowing before the first deploy: **keep port 80 published anyway.** Let's Encrypt's HTTP-01
challenge starts there, and it is not a browser, so it does not consult the preload list. Closing 80
because "nothing can use http now" is how you fail a challenge against the rate limit below.

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

`deploy.sh` pulls the images CI built, starts them, and then polls `https://$API_DOMAIN/health`
from outside, through Caddy, over TLS. A container being "up" proves nothing: the backend
crash-loops on a missing variable, and Flyway migrates on every boot, so a bad migration surfaces
here and nowhere earlier.

### 4. Frontend

On Vercel, from the repo, root directory `frontend/`:

```
NEXT_PUBLIC_API_BASE_URL=https://api.sharpeyes.app
NEXT_PUBLIC_AUTH_BASE_URL=https://api.sharpeyes.app
NEXT_PUBLIC_PASSWORD_LOGIN=false
```

The last one mirrors the box's `AUTH_PASSWORD_LOGIN` and decides only what is OFFERED. The service
decides what WORKS, so the two disagreeing hides a working form or shows a refused one, and neither
signs the wrong person in. Change them together anyway.

Both are the API hostname: Caddy serves sign-in from it under `/api/auth`, so there is no third
name to point at anything.

Then register the redirect URI in the Discord application
(<https://discord.com/developers/applications> → *OAuth2*), exactly:

```
https://api.sharpeyes.app/api/auth/callback/discord
```

Discord matches it character for character, a trailing slash included, and refuses anything else.

### 5. Backups

```bash
crontab -e
# 07:30 UTC, half an hour after the Lightsail snapshot
30 7 * * * cd /home/ubuntu/sharpeyes && ./scripts/backup-db.sh >> /var/log/sharpeyes-backup.log 2>&1
```

**Then rehearse the restore, once, before you need it** (below). An untested backup is a file you
believe is a backup.

## Deploying a change

Push to master and let CI publish the images, then:

```bash
ssh ubuntu@<static-ip>
cd sharpeyes && ./deploy.sh
```

**No downtime.** Two backend replicas sit behind Caddy, and `deploy.sh` restarts one at a time,
waiting for each to answer `/health` before touching the next. Measured on the real images, polling
`/health` through Caddy every 20ms across a deploy:

| Deploy | Requests | Failures | Slowest request |
| --- | --- | --- | --- |
| backend change | 224 | 0 | 109ms |
| parser change | 267 | 0 | 4.6s (one request) |

A parser change is the worse case because both replicas live in vision's network namespace and have
to restart with it. Caddy's `lb_try_duration` absorbs that gap rather than returning 502, so it
costs one slow request rather than errors.

Nothing is built on the box. `.github/workflows/publish-images.yml` pushes both images to GHCR
tagged with the commit SHA, and `deploy.sh` pulls that tag. Two consequences worth knowing:

- **The images are public**, inherited from the repository, so the box pulls them without a
  registry login. Verified anonymously against GHCR: both manifests answer 200 with no credentials.
  If that ever changes, a pull 403s and the Packages tab is the only place to look.
- **`deploy.sh` waits up to 5 minutes** for the images to appear, because a deploy run straight
  after a merge will beat CI to the registry.

Flyway still migrates on boot, which is why the script polls `https://$API_DOMAIN/health` from
outside rather than trusting `docker compose ps`.

Running `docker compose` by hand on the box needs `IMAGE_TAG` set, even for `logs` or `ps`: Compose
interpolates the whole file on every subcommand. Any value works when you are not starting anything.
There is deliberately no default, because a `latest` that silently outranks the checked-out commit
is how a rollback ends up running the code it was rolling back from.

### Migrations must survive the previous release

Both replicas do not restart at once, so for the length of a deploy the **old code runs against the
new schema**. That is not a property of this script, it is what rolling anything means.

Dropping or renaming a column therefore takes two deploys: add the new shape and write to both,
deploy, then remove the old one in a later commit. Flyway's lock handles the concurrency itself
(verified: two replicas booting against an empty database, one applied all 66 migrations while the
other waited and found it up to date), so the risk is never a corrupt schema. It is the old binary
selecting a column that the new schema no longer has.

### Rolling back

Revert on master and deploy that, which keeps the box on a branch and CI on the thing that is
running. When it has to be faster than a PR, roll back on the box, bypassing `deploy.sh`:

```bash
git checkout <last-good-sha>                                   # detached HEAD
IMAGE_TAG=$(git rev-parse HEAD) docker compose \
  -f docker-compose.yml -f docker-compose.prod.yml up -d
```

`IMAGE_TAG` has to be set by hand here, because it is `deploy.sh` that normally derives it from the
checkout. Without it Compose has no tag to pull and refuses to start. Note this restarts both
replicas at once, so unlike a deploy it is not free; it is the emergency path.

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
aws s3 ls s3://sharpeyes-backups-<account-id>/
aws s3 cp s3://sharpeyes-backups-<account-id>/sharpeyes-<stamp>.sql.gz .

# On the box, into a scratch database first:
gunzip -c sharpeyes-<stamp>.sql.gz | \
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
- **Naming `vision` in `up -d` strands both replicas, permanently.** Naming services limits what
  Compose will recreate to those services, so a replaced vision container leaves the replicas
  holding a namespace with nothing in it. Measured on the real stack: all five services keep
  reporting `running`, Caddy gets connection refused on both upstreams, and it never recovers,
  because nothing about the replicas changed and a later `up -d` will not touch them. `up -d` with
  **no service names** does handle it, but that is not something a rolling deploy can use, so
  `deploy.sh` compares vision's container id across the call and restarts both replicas itself when
  it changed.
- **Do not shrink screenshots in the browser** to speed up uploads from far away. That is the bug
  this project exists to prevent: an OCR path that resampled its own evidence away and returned
  confident wrong counts. Uploads are 1.25-3.1 MB and that is fine.
- **Do not switch the backend to a fat jar.** Shading clobbers `META-INF/services` and silently
  breaks Flyway, which migrates on every boot. `backend/Dockerfile` says so too.
- The box needs egress to `nexon.com` (character lookups).
