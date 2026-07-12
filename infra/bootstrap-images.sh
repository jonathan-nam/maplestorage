#!/usr/bin/env bash
# First-deploy bootstrap. Run this once, before the first `terraform apply` that
# creates the ECS service.
#
# The problem it solves: ecs.tf pins both containers to `:latest`, but
# `terraform apply` creates the ECR repositories empty. A service created against
# an image that does not exist cannot start a single task -- and because the
# deployment circuit breaker has no previous revision to roll back to on a first
# deploy, the service just sits at zero running tasks while ECS retries a pull
# that will never succeed. The failure looks like a capacity or networking
# problem and is not one.
#
# So: create the repositories, put an image in each, and only then create the
# service. After this, deploy-backend.yml takes over and every deploy pushes
# SHA-tagged images; `:latest` is never used again except as the shape Terraform
# registers the task definition with.
#
#   ./bootstrap-images.sh          # do it
#   ./bootstrap-images.sh --plan   # show what it would do
set -euo pipefail

cd "$(dirname "$0")"

REGION="$(grep -oP 'aws_region\s*=\s*"\K[^"]+' terraform.tfvars 2>/dev/null || echo us-east-1)"
PROJECT="$(grep -oP 'project_name\s*=\s*"\K[^"]+' terraform.tfvars 2>/dev/null || echo maplestorage)"
DRY_RUN="${1:-}"

run() {
  if [[ "$DRY_RUN" == "--plan" ]]; then
    echo "  would run: $*"
  else
    "$@"
  fi
}

ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
REGISTRY="${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com"
echo "account=${ACCOUNT} region=${REGION} registry=${REGISTRY}"

# 1. Create only the repositories. Targeting them keeps the service (which is
#    what would fail) from being created in the same pass.
echo
echo "==> creating ECR repositories"
run terraform apply \
  -target=aws_ecr_repository.backend \
  -target=aws_ecr_repository.vision \
  -auto-approve

# 2. Log in and seed one image per repository.
echo
echo "==> pushing a :latest image to each repository"
if [[ "$DRY_RUN" != "--plan" ]]; then
  aws ecr get-login-password --region "$REGION" |
    docker login --username AWS --password-stdin "$REGISTRY"
fi

for svc in backend vision; do
  image="${REGISTRY}/${PROJECT}-${svc}:latest"
  echo "  building ${svc} -> ${image}"
  run docker build -t "$image" "../${svc}"
  run docker push "$image"
done

# 3. Now the full apply can create a service whose images actually resolve.
echo
echo "==> applying the rest of the stack"
run terraform apply -auto-approve

echo
echo "Done. From here, deploys go through .github/workflows/deploy-backend.yml,"
echo "which builds both images, tags them with the commit SHA, and registers a"
echo "new task-definition revision. Terraform no longer owns which revision the"
echo "service runs (see the lifecycle block on aws_ecs_service.backend)."
