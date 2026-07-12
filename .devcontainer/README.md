# Dev container

Open the repo in VS Code and reopen in the container. `post-create.sh` installs
pre-commit, pins the JDK, bootstraps the Gradle wrapper, and warns you if the workspace
is in the wrong place — which brings us to the one thing that matters most.

## Keep the repo on the Linux filesystem, not the Windows drive

**Do this once. It is the highest-leverage change available to this environment.**

If the repo lives on the Windows `C:` drive, WSL2 reaches it over **9p**, and 9p has no
**inotify**. That means:

- **Hot reload cannot work.** Not "is flaky" — *cannot*. The Next dev server never sees
  an edit, so it silently serves the code it compiled when it started. You change a file,
  reload, and nothing happens. Its compile log stays empty, which reads as success. This
  cost several hours before we found it. Polling does not rescue it: `WATCHPACK_POLLING`,
  `CHOKIDAR_USEPOLLING` and `TURBOPACK_FORCE_POLLING` were each tried, and each failed.
- **Everything is ~18× slower.** 300 small writes: **577 ms** on 9p, **31 ms** on ext4.
  That tax lands on npm, Gradle, pytest and git.

Fix it from a **WSL terminal on Windows** (not from inside the container — the filesystem
it needs to write to is the one the container cannot see):

```bash
find /mnt/c/Users -maxdepth 5 -type d -name maplestorage   # locate it
bash /mnt/c/.../maplestorage/scripts/move-to-wsl.sh        # copies to ~/projects
```

Then `cd ~/projects/maplestorage && code .` and *Reopen in Container*. It **copies** rather
than clones, so your `.env` files and uncommitted work come with it, and it leaves the
original alone until you delete it yourself.

Confirm inside the new container:

```bash
stat -f -c %T /workspaces/maplestorage    # want ext4/overlayfs, NOT v9fs
```

`post-create.sh` prints a loud warning if you are still on 9p.

### If you are stuck on 9p anyway

After **every** frontend edit:

```bash
cd frontend && fuser -k 3000/tcp; sleep 2; rm -rf .next
nohup npm run dev > /tmp/next.log 2>&1 & disown
```

and hard-refresh the browser (`Ctrl+Shift+R`) — the CSS filename never changes between
builds, so a normal reload serves the cached copy. **Verify the bytes, not the log**: the
log is silent precisely *because* nothing recompiled.

```bash
CSS=$(curl -s localhost:3000/ | grep -oE '/_next/static/[^"]*\.css' | head -1)
curl -s "localhost:3000$CSS" | grep -c 'a-class-you-just-added'
```

## Credentials survive rebuilds

`~/.aws` and `~/.config/gh` are bind-mounted from the host (see `devcontainer.json`), so
`aws configure` and `gh auth login` are one-time, not once-per-rebuild. `.gitconfig` and
the SSH agent are forwarded by VS Code itself.

## Rebuilding the vision service breaks the backend

The backend shares the vision container's network namespace (`network_mode:
service:vision`, deliberately — it mirrors how ECS co-locates them). Rebuilding vision
*recreates* that container, and the backend's networking goes with it: uploads start
failing with "Upload failed, check your connection".

**Always restart the backend after rebuilding vision:**

```bash
docker compose up -d --build vision
docker compose up -d --force-recreate backend
```

## It froze, and Docker Desktop won't stop it

Symptom: the container locks up after a while, you get an HTTP 500, Docker Desktop's
stop/restart buttons do nothing, and a reboot is the only thing that works.

It has run out of memory. WSL2 gives its VM roughly half the host's RAM by default,
and everything runs inside it — VS Code's server, language servers, Docker builds,
the local stack, and the JVMs a Gradle build spawns. When that fills, WSL thrashes,
the Docker API stops answering (the 500), and Docker Desktop cannot stop a VM that
is no longer scheduling.

**You do not need to reboot.** From PowerShell on the host:

```powershell
wsl --shutdown
```

That clears the wedged VM in seconds. Restart Docker Desktop and reopen the
container. If `wsl --shutdown` itself hangs, `Restart-Service LxssManager` in an
elevated PowerShell is the next step.

**To stop it recurring**, create or edit `%UserProfile%\.wslconfig` on the host and
run `wsl --shutdown` once for it to take effect:

```ini
[wsl2]
memory=12GB           # more than the 50% default; leave the host some headroom
swap=8GB              # a memory spike gets slow instead of wedging
autoMemoryReclaim=gradual   # WSL 2.0+: hands freed memory back to Windows
```

Tune `memory` to your machine. `swap` matters more than it looks — without it, a
spike wedges the VM instead of just slowing down.

`backend/gradle.properties` also caps the Gradle and Kotlin daemons and the worker
count, so a build cannot claim a third of the VM on its own. Raise those if you have
memory to spare.
