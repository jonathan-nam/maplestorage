terraform {
  # 1.10+ required for use_lockfile (native S3 state locking, below).
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
  }

  # State holds the backup IAM user's SECRET ACCESS KEY in plaintext, so it lives
  # in a private, encrypted, versioned S3 bucket rather than on one laptop next to
  # a public repo.
  #
  # No DynamoDB lock table: since 1.10, S3 does state locking natively via
  # use_lockfile (a .tflock object beside the state), and dynamodb_table is
  # deprecated.
  #
  # bucket/region come from backend.hcl (gitignored, it names the bucket, and
  # this repo is public). Bootstrap the bucket and generate that file with:
  #   ./bootstrap-state-backend.sh
  # then:
  #   terraform init -backend-config=backend.hcl -migrate-state
  backend "s3" {
    key          = "infra/terraform.tfstate"
    encrypt      = true
    use_lockfile = true
  }
}
