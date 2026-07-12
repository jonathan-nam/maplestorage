resource "aws_ecs_cluster" "main" {
  name = "${var.project_name}-cluster"

  setting {
    name  = "containerInsights"
    value = "disabled" # extra CloudWatch cost; enable later if debugging needs it
  }
}

resource "aws_cloudwatch_log_group" "backend" {
  name              = "/ecs/${var.project_name}-backend"
  retention_in_days = 14
}

# Execution role: what ECS itself uses to pull the image and ship logs.
# Distinct from the task role below, which is what the *app code* can do.
resource "aws_iam_role" "ecs_task_execution" {
  name = "${var.project_name}-ecs-task-execution-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_task_execution" {
  role       = aws_iam_role.ecs_task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Execution role additionally needs read access to the one Secrets Manager
# entry it injects into the container -- not covered by the managed policy above.
resource "aws_iam_role_policy" "ecs_task_execution_secrets" {
  name = "${var.project_name}-ecs-task-execution-secrets"
  role = aws_iam_role.ecs_task_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = [aws_secretsmanager_secret.db_credentials.arn]
    }]
  })
}

# Task role: what the running Ktor app itself is permitted to do (S3 access
# for screenshots gets added here once that bucket exists -- not in M0's scope).
resource "aws_iam_role" "ecs_task" {
  name = "${var.project_name}-ecs-task-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
}

resource "aws_ecs_task_definition" "backend" {
  family                   = "${var.project_name}-backend"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  # Two containers, one task. Under awsvpc they share a network namespace, so
  # the backend reaches the vision service on 127.0.0.1 -- no service discovery,
  # no load balancer, and the vision port is never reachable from outside the
  # task. They also share a lifecycle: one deploy, one rollback.
  container_definitions = jsonencode([{
    name      = "backend"
    image     = "${aws_ecr_repository.backend.repository_url}:latest"
    essential = true

    # Starting the backend before the vision service is up would just produce a
    # window of failed uploads on every deploy.
    dependsOn = [{
      containerName = "vision"
      condition     = "HEALTHY"
    }]

    portMappings = [{
      containerPort = var.container_port
      protocol      = "tcp"
    }]

    environment = [
      { name = "DB_HOST", value = aws_db_instance.main.address },
      { name = "DB_PORT", value = tostring(aws_db_instance.main.port) },
      { name = "DB_NAME", value = var.db_name },
      { name = "CLERK_JWKS_URL", value = var.clerk_jwks_url },
      { name = "FRONTEND_ORIGIN", value = var.frontend_origin },
      { name = "VISION_SERVICE_URL", value = "http://127.0.0.1:${var.vision_container_port}" },
    ]

    secrets = [
      {
        name      = "DB_USERNAME"
        valueFrom = "${aws_secretsmanager_secret.db_credentials.arn}:username::"
      },
      {
        name      = "DB_PASSWORD"
        valueFrom = "${aws_secretsmanager_secret.db_credentials.arn}:password::"
      },
    ]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.backend.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "backend"
      }
    }
    },
    {
      name  = "vision"
      image = "${aws_ecr_repository.vision.repository_url}:latest"

      # The backend cannot parse a screenshot without it, so if it dies the task
      # should be replaced rather than left serving broken uploads.
      essential = true

      # No portMappings: the service binds 127.0.0.1 and is only ever called
      # from the backend container in this same task.

      # The image has no curl; python is what it has.
      healthCheck = {
        command = [
          "CMD-SHELL",
          "python -c \"import urllib.request; urllib.request.urlopen('http://127.0.0.1:${var.vision_container_port}/health')\" || exit 1",
        ]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 30
      }

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.backend.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "vision"
        }
      }
  }])
}

resource "aws_ecs_service" "backend" {
  name    = "${var.project_name}-backend"
  cluster = aws_ecs_cluster.main.id

  # Terraform only ever sets this once, at create time. From then on the field
  # belongs to deploy-backend.yml, which registers a SHA-tagged revision per
  # deploy and points the service at it.
  #
  # Without the ignore_changes below, the two fight: Terraform sees the service
  # on a revision it did not create, decides that is drift, and reverts the
  # service to its own revision -- which pins `:latest`. A `terraform apply` run
  # for an unrelated reason (a security-group tweak, say) would silently roll
  # back whatever was last deployed. Deploys own the revision; Terraform owns
  # the shape of the task definition.
  task_definition = aws_ecs_task_definition.backend.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  lifecycle {
    ignore_changes = [task_definition, desired_count]
  }

  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = true # required to reach the internet with no NAT Gateway -- see network.tf
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.backend.arn
    container_name   = "backend"
    container_port   = var.container_port
  }

  # Without this, a deploy whose new task never passes the ALB health check
  # just leaves the service stuck -- no automatic recovery, only a human
  # noticing later. This makes ECS detect a failed rollout and revert to the
  # last known-good task definition on its own.
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  depends_on = [aws_lb_listener.http]
}
