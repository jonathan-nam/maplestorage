# infra

Terraform: VPC, ALB, ECS (Fargate), ECR (two repositories), RDS.

## Two bootstrap scripts, and the order matters

Both exist for the same reason, a **chicken-and-egg** Terraform cannot resolve on
its own, but they solve different ones, and running them out of order wastes a
deploy attempt.

| # | Script | Solves |
| --- | --- | --- |
| 1 | `bootstrap-state-backend.sh` | The S3 bucket that holds Terraform state must exist *before* Terraform can use it as a backend, so it cannot be a resource in this config. |
| 2 | `bootstrap-images.sh` | The task definition pins both containers to `:latest`, but `terraform apply` creates the ECR repositories **empty**. |

Both are idempotent. Run them once each, in that order, on a fresh account.

### Why (2) matters more than it looks

A service created against an image that does not exist cannot start a single task.
On a *first* deploy the deployment circuit breaker has no previous revision to roll
back to, so the service just sits at zero running tasks, retrying a pull that will
never succeed. The symptom looks like a capacity or networking fault and is
neither.

`bootstrap-images.sh` does it in the order that works: create the repositories
(targeted, so the service is not created yet) → push an image to each → apply the
rest.

After that, `.github/workflows/deploy-backend.yml` owns image pushes. It builds
**both** images and tags them with the same commit SHA, the vision service's wire
format is a contract the backend compiles against, so shipping one without the
other yields a task that starts and then fails every upload.

## Terraform does not own which revision is deployed

`aws_ecs_service.backend` has `ignore_changes = [task_definition, desired_count]`,
and that is load-bearing. Terraform sets the task definition once, at create time.
From then on the field belongs to the deploy workflow, which registers a
SHA-tagged revision per deploy.

Without it the two fight: Terraform sees the service on a revision it did not
create, decides that is drift, and reverts, so a `terraform apply` run for an
entirely unrelated reason (a security-group tweak, say) would **silently roll back
whatever was last deployed**, onto `:latest` images.

**Deploys own the revision; Terraform owns the shape of the task definition.**

## Two containers, one task

The backend and the vision service run in the same ECS task. Under `awsvpc` they
share a network namespace, so the backend reaches the parser on `127.0.0.1`. No
service discovery, no load balancer, no network hop, and the vision port is not
reachable from outside the task. They share a lifecycle too: one deploy, one
rollback, and the circuit breaker covers both.

The backend `dependsOn` the vision container being `HEALTHY`, so a deploy cannot
serve uploads before the parser is up.

`docker-compose.yml` at the repo root reproduces this exactly (the backend joins
the vision container's network namespace), so the loopback assumption is tested
locally rather than discovered in production.

## Cost

Roughly **$27–32/month** baseline: ALB ~$16–20, Fargate (0.25 vCPU / 1 GiB, one
task, 24/7) ~$10.60, ECR + Secrets Manager + CloudWatch ~$1–3. RDS on top (free for
12 months, ~$15/mo after).

Task memory went 512 MiB → 1 GiB when the vision container was added (~+$1.60/mo).
CPU stays at 256 units, now shared by both containers, a parse is ~0.3s of CPU, so
it competes with the JVM and an upload may take a couple of seconds. Raising
`task_cpu` to 512 roughly halves that, for about $9/month more. Worth it only if
upload latency turns out to matter.

Everything is billed hourly/per-second, so `terraform destroy` between sessions
only pays for hours actually running.

## State

State lives in an encrypted S3 bucket (`versions.tf`). Copy `backend.hcl.example`
to `backend.hcl` and `terraform init -backend-config=backend.hcl`.
