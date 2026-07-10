terraform {
  required_version = ">= 1.9"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # M0: local state to get moving. Revisit before a second contributor or CI
  # touches this -- an S3 backend + DynamoDB lock table is the standard fix,
  # deliberately not set up yet since it's a one-person project so far.
  # backend "s3" {}
}
