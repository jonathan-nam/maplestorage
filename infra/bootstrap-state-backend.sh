#!/usr/bin/env bash
# One-time bootstrap of the S3 bucket that holds Terraform state.
#
# Chicken-and-egg: the backend bucket must exist before Terraform can use it as
# a backend, so it can't be a resource in this config -- it's created here with
# the AWS CLI instead. Idempotent: safe to re-run.
#
# Afterwards:
#   terraform init -backend-config=backend.hcl -migrate-state
set -euo pipefail
cd "$(dirname "$0")"

REGION="${AWS_REGION:-us-east-1}"
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
BUCKET="maplestorage-tfstate-${ACCOUNT_ID}"

echo "Region:  $REGION"
echo "Bucket:  $BUCKET"

if aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  echo "Bucket already exists -- skipping creation."
else
  # us-east-1 is the one region that rejects a LocationConstraint.
  if [ "$REGION" = "us-east-1" ]; then
    aws s3api create-bucket --bucket "$BUCKET" --region "$REGION"
  else
    aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" \
      --create-bucket-configuration "LocationConstraint=$REGION"
  fi
  echo "Created bucket."
fi

# Versioning: state is the only record of what's deployed. A corrupt or
# truncated write is otherwise unrecoverable; versioning makes it a rollback.
aws s3api put-bucket-versioning --bucket "$BUCKET" \
  --versioning-configuration Status=Enabled

# Encryption at rest. State contains the RDS password in plaintext.
aws s3api put-bucket-encryption --bucket "$BUCKET" \
  --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"},"BucketKeyEnabled":true}]}'

# Belt and braces: this bucket must never be public, regardless of any policy
# added later.
aws s3api put-public-access-block --bucket "$BUCKET" \
  --public-access-block-configuration \
  'BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true'

cat > backend.hcl <<EOF
bucket = "$BUCKET"
region = "$REGION"
EOF

echo
echo "Wrote backend.hcl (gitignored)."
echo "Next:  terraform init -backend-config=backend.hcl -migrate-state"
echo "Then, once state is confirmed in S3, delete the local copies:"
echo "  rm terraform.tfstate terraform.tfstate.backup"
