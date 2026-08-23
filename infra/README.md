# infra

Terraform for the production environment: **one Lightsail box**, a static IP, its firewall, and the
S3 bucket the nightly `pg_dump` goes to. That is all of it, about 40 lines of resources.

The box runs `docker compose -f docker-compose.yml -f docker-compose.prod.yml`: Caddy, the backend,
the vision service and Postgres. See [`docs/deploy.md`](../docs/deploy.md) for how to stand it up
and deploy to it.

## What used to be here, and why it is gone

An ECS/Fargate + ALB + RDS design across two AZs. It is in git history if it is ever worth
revisiting, and at real traffic it would be. Two measurements retired it:

- **It cost ~$50/month always-on** to run two containers allocated **0.25 vCPU between them**
  (`task_cpu = 256`). The ALB alone was $16.42/month to forward traffic to a single target.
- **It had never actually run.** Cost Explorer showed no Fargate charges across the three days the
  stack existed, because no task ever started. The CI deploy role could only push one of the two
  images it needed (`github-oidc.tf` scoped ECR push to the backend repository, while the workflow
  pushes backend *and* vision), so the first real deploy would have failed on the vision push.

This box is $12/month for 2 vCPUs, and it terminates TLS, which the ALB never did (port 80 only).

## Terraform cannot see an `aws login` session

Export the credentials into the shell first, every time:

```bash
eval "$(aws configure export-credentials --format env)"
```

`aws login` keeps its session under `~/.aws/login` and refers to it with `login_session` in
`~/.aws/config`. That is an AWS CLI mechanism, so there is no `~/.aws/credentials` file, and the
provider's Go SDK does not implement it. It also does not fail in a way that points at the cause:
it says **"No valid credential sources found"** and spends 30 seconds timing out against the EC2
metadata endpoint at 169.254.169.254, which reads like a network fault.

The credentials are temporary, so this is per shell rather than once.

## Bootstrap the state backend first

`bootstrap-state-backend.sh` creates the versioned, encrypted S3 bucket that holds Terraform state.
Run it **once, before the first apply**. It cannot be a resource in this config, because the bucket
has to exist before Terraform can use it as a backend.

This matters more than it used to: state now contains the backup user's **secret access key**, and
on a laptop it is a plaintext file sitting next to a public repository.

```bash
./bootstrap-state-backend.sh              # once, ever
terraform init -backend-config=backend.hcl
terraform apply
```

## Rebuilding the box

This is why the box is defined here rather than clicked into the console. One box is a single point
of failure, and the answer to that is `terraform apply`.

A rebuilt instance is **empty**: Docker and nothing else. Restore the database from the S3 backup,
per the runbook in [`docs/deploy.md`](../docs/deploy.md).

## Two locks on the same door

Postgres (5432) and the vision service (8000) must never be reachable from the internet. Two
independent things enforce that, so it takes two mistakes rather than one:

1. `aws_lightsail_instance_public_ports` opens 80, 443 and 22, and is authoritative: it *replaces*
   Lightsail's defaults rather than adding to them.
2. `docker-compose.prod.yml` unpublishes the dev ports with `ports: !reset []`, which is necessary
   because Compose **merges** `ports` across files rather than replacing them.

Check it after every apply, from off the box:

```bash
curl --max-time 5 http://<static-ip>:5432   # must fail
curl --max-time 5 http://<static-ip>:8000   # must fail
```
