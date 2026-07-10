provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "maplestorage"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}
