output "alb_dns_name" {
  description = "Public DNS name of the ALB -- this is the backend's base URL until a real domain is set up."
  value       = aws_lb.main.dns_name
}

output "ecr_repository_url" {
  description = "Push the Ktor image here (docker push <this>:latest) before the ECS service can start healthy."
  value       = aws_ecr_repository.backend.repository_url
}

output "rds_endpoint" {
  description = "RDS connection address (host:port). Only reachable from inside the VPC."
  value       = aws_db_instance.main.endpoint
}

output "db_credentials_secret_arn" {
  description = "Secrets Manager ARN holding the generated DB username/password."
  value       = aws_secretsmanager_secret.db_credentials.arn
}
