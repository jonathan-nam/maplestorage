# Where the nightly pg_dump goes (scripts/backup-db.sh).
#
# The database lives in a container on the box, so its durability is entirely this bucket plus the
# instance snapshot. Treat it accordingly.

data "aws_caller_identity" "current" {}

resource "aws_s3_bucket" "backups" {
  bucket = "${var.project_name}-backups-${data.aws_caller_identity.current.account_id}"
}

# Versioned, so a corrupt dump overwriting a good one is recoverable rather than terminal.
resource "aws_s3_bucket_versioning" "backups" {
  bucket = aws_s3_bucket.backups.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "backups" {
  bucket                  = aws_s3_bucket.backups.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id

  rule {
    id     = "expire-old-dumps"
    status = "Enabled"

    filter {}

    expiration {
      days = var.backup_retention_days
    }

    noncurrent_version_expiration {
      noncurrent_days = var.backup_retention_days
    }
  }
}

# Lightsail instances CANNOT assume an IAM role: there is no instance profile, which is the one
# real ergonomic loss against EC2. So the box needs a key pair, and it gets the narrowest one
# possible: put an object into this bucket, and nothing else. It cannot read, list or delete, so a
# compromised box can neither exfiltrate the backups nor destroy them.
resource "aws_iam_user" "backup" {
  name = "${var.project_name}-${var.environment}-backup"
}

resource "aws_iam_user_policy" "backup" {
  name = "${var.project_name}-backup-put-only"
  user = aws_iam_user.backup.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["s3:PutObject"]
      Resource = ["${aws_s3_bucket.backups.arn}/*"]
    }]
  })
}

# The secret lands in Terraform state, which is why the S3 state backend (versions.tf,
# bootstrap-state-backend.sh) is not optional here. State is encrypted at rest there; on a laptop
# it is a plaintext file next to a public repo.
resource "aws_iam_access_key" "backup" {
  user = aws_iam_user.backup.name
}
