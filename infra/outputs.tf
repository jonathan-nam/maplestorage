output "static_ip" {
  description = "Point the api.<domain> A record at this. certbot cannot get a certificate until it resolves."
  value       = aws_lightsail_static_ip.app.ip_address
}

output "ssh_command" {
  description = "How to get onto the box. The key is downloaded from the Lightsail console."
  value       = "ssh -i <your-lightsail-key.pem> ubuntu@${aws_lightsail_static_ip.app.ip_address}"
}

output "backup_bucket" {
  description = "BACKUP_BUCKET for scripts/backup-db.sh."
  value       = aws_s3_bucket.backups.id
}

output "backup_access_key_id" {
  description = "AWS_ACCESS_KEY_ID for the box's .env. Put-only, scoped to the backup bucket."
  value       = aws_iam_access_key.backup.id
}

# `terraform output -raw backup_secret_access_key` to read it. Never echoed by a plain
# `terraform output`, and it is the reason state belongs in the encrypted S3 backend.
output "backup_secret_access_key" {
  description = "AWS_SECRET_ACCESS_KEY for the box's .env."
  value       = aws_iam_access_key.backup.secret
  sensitive   = true
}
