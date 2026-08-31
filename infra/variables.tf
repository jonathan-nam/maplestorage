variable "aws_region" {
  description = "AWS region for all resources."
  type        = string
  default     = "us-east-1"
}

variable "availability_zone" {
  description = "AZ for the Lightsail instance. Must be inside aws_region."
  type        = string
  default     = "us-east-1a"
}

variable "environment" {
  description = "Deployment environment name, used in resource naming/tags."
  type        = string
  default     = "prod"
}

variable "project_name" {
  description = "Short project name, used as a prefix for resource names."
  type        = string
  # Renaming this renames the instance, the static IP and the backups bucket, so it is only free
  # before the first apply. The Terraform state bucket is NOT derived from it, see
  # bootstrap-state-backend.sh.
  default = "sharpeyes"
}

# small_3_0: $12/mo, 2 vCPU, 2 GB RAM, 60 GB SSD, 3 TB transfer, static IPv4 included.
#
# NOT micro_3_0 ($7, 1 GB RAM). Two backend replicas at the ~390 MB each that cloud-init.sh
# records, plus auth, Postgres, nginx and the OS, does not fit in 1 GB. Nothing sets -Xmx anywhere,
# so each JVM takes 25% of the box: halving the bundle halves both replicas' heap ceiling as well as
# the headroom around them. Do not re-derive that 390 MB on a dev host, a bigger host raises the
# ceiling and the number with it.
#
# NOT any *_ipv6_* bundle. Those are $2 cheaper because they have no public IPv4 address, and a
# meaningful share of the internet still cannot reach an IPv6-only host.
variable "bundle_id" {
  description = "Lightsail bundle (instance size)."
  type        = string
  default     = "small_3_0"
}

# Defaults to the whole internet because the deploying human's IP is dynamic. Narrow it if you have
# a fixed address: SSH is the only port here that is not meant to be public.
variable "ssh_allowed_cidrs" {
  description = "CIDRs permitted to reach SSH."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "backup_retention_days" {
  description = "How long a nightly pg_dump is kept in S3 before it expires."
  type        = number
  default     = 30
}
