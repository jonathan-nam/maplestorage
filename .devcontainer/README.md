# Dev container

Open the repo in VS Code and reopen in the container. `post-create.sh` installs
pre-commit, pins the JDK, and bootstraps the Gradle wrapper.

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
