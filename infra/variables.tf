variable "aws_region" {
  description = "AWS region for all resources."
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Deployment environment name, used in resource naming/tags."
  type        = string
  default     = "dev"
}

variable "project_name" {
  description = "Short project name, used as a prefix for resource names."
  type        = string
  default     = "maplestorage"
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC."
  type        = string
  default     = "10.0.0.0/16"
}

variable "public_subnet_cidrs" {
  description = "CIDR blocks for the public subnets (ALB + ECS tasks), one per AZ."
  type        = list(string)
  default     = ["10.0.0.0/24", "10.0.1.0/24"]
}

variable "private_subnet_cidrs" {
  description = "CIDR blocks for the private subnets (RDS only), one per AZ."
  type        = list(string)
  default     = ["10.0.10.0/24", "10.0.11.0/24"]
}

variable "db_instance_class" {
  description = "RDS instance class."
  type        = string
  default     = "db.t3.micro"
}

variable "db_name" {
  description = "Initial database name."
  type        = string
  default     = "maplestorage"
}

variable "db_username" {
  description = "Master username for RDS. Password is generated and stored in Secrets Manager, not set here."
  type        = string
  default     = "maplestorage_app"
}

variable "container_port" {
  description = "Port the Ktor container listens on."
  type        = number
  default     = 8080
}

# Shared by both containers. A parse is ~0.5s of CPU single-threaded, so at 256
# (0.25 vCPU) it competes with the JVM and a screenshot takes a couple of
# seconds. Raising this to 512 roughly halves that, for about $9/month more --
# worth it only if upload latency turns out to matter.
variable "task_cpu" {
  description = "Fargate task CPU units, shared by the backend and vision containers (256 = 0.25 vCPU)."
  type        = number
  default     = 256
}

# 512 MiB was enough for the JVM alone. The task now also runs the vision
# container (Python + OpenCV, ~250 MiB resident), so it needs 1 GiB. On Fargate
# this costs about $1.60/month more.
variable "task_memory" {
  description = "Fargate task memory in MiB (shared by the backend and vision containers)."
  type        = number
  default     = 1024
}

variable "vision_container_port" {
  description = "Loopback port the vision service listens on. Never exposed outside the task."
  type        = number
  default     = 8000
}

variable "clerk_jwks_url" {
  description = "Clerk JWKS endpoint URL, passed to Ktor for JWT verification."
  type        = string
}

variable "frontend_origin" {
  description = "Deployed Next.js origin (e.g. https://maplestorage.vercel.app), passed to Ktor for CORS."
  type        = string
}
