# One box. It runs docker compose (caddy, backend, vision, postgres), and that is the whole
# production environment.
#
# This replaced an ECS/Fargate + ALB + RDS design, which is in git history if it is ever worth
# revisiting. Two measurements killed it: it billed ~$50/month always-on to run two containers that
# were allocated 0.25 vCPU *between them*, and it had never actually run (no Fargate charges ever
# appeared, and the CI deploy role could not push the vision image). This is $12/month for 2 vCPU.
#
# The point of defining the box here rather than clicking it into existence: a single box is a
# single point of failure, and the answer to that is being able to rebuild it with one command.

resource "aws_lightsail_instance" "app" {
  name              = "${var.project_name}-${var.environment}"
  availability_zone = var.availability_zone
  blueprint_id      = "ubuntu_24_04"
  bundle_id         = var.bundle_id

  # Installs docker and the compose plugin on first boot, and nothing else. Cloning the repo,
  # writing .env and deploying stay manual: see docs/deploy.md. Baking secrets into user_data
  # would put them in the Lightsail console in plaintext.
  user_data = file("${path.module}/cloud-init.sh")

  # Whole-instance snapshots, daily. This is the cheap half of the backup story and it protects
  # against the box dying. It does NOT replace the pg_dump in scripts/backup-db.sh, which protects
  # against the database being wrong rather than the disk being gone.
  add_on {
    type          = "AutoSnapshot"
    snapshot_time = "07:00" # UTC, must be on the hour
    status        = "Enabled"
  }

  tags = {
    Name = "${var.project_name}-${var.environment}"
  }
}

# A static IP, because DNS points at it. Without one the address changes on stop/start and the A
# record silently goes stale. Attached ones are free; unattached ones are billed, so never leave
# this dangling.
resource "aws_lightsail_static_ip" "app" {
  name = "${var.project_name}-${var.environment}-ip"
}

resource "aws_lightsail_static_ip_attachment" "app" {
  static_ip_name = aws_lightsail_static_ip.app.name
  instance_name  = aws_lightsail_instance.app.name
}

# 80 and 443 for Caddy, 22 for deploys. Nothing else.
#
# This resource is authoritative: it REPLACES Lightsail's defaults rather than adding to them.
# That is what we want, and it is the second lock on the same door as `ports: !reset []` in
# docker-compose.prod.yml. Postgres (5432) and the parser (8000) must never be reachable from the
# internet, and it should take two independent mistakes, not one, for that to happen.
resource "aws_lightsail_instance_public_ports" "app" {
  instance_name = aws_lightsail_instance.app.name

  port_info {
    protocol  = "tcp"
    from_port = 80
    to_port   = 80
  }

  port_info {
    protocol  = "tcp"
    from_port = 443
    to_port   = 443
  }

  # HTTP/3.
  port_info {
    protocol  = "udp"
    from_port = 443
    to_port   = 443
  }

  port_info {
    protocol  = "tcp"
    from_port = 22
    to_port   = 22
    cidrs     = var.ssh_allowed_cidrs
  }
}
