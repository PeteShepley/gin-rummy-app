variable "aws_region" {
  description = "AWS region for gin-rummy-app resources"
  type        = string
  default     = "us-east-1"
}

variable "github_repo" {
  description = "GitHub repository allowed to assume the deploy roles (format: owner/repo)"
  type        = string
  default     = "PeteShepley/gin-rummy-app"
}

variable "api_domain_name" {
  description = "Custom domain for the API's HTTP API"
  type        = string
  default     = "gin-rummy.api.peteshepley.com"
}

variable "api_root_domain_name" {
  description = "Root domain whose wildcard ACM cert covers api_domain_name"
  type        = string
  default     = "api.peteshepley.com"
}

variable "cors_allowed_origins" {
  description = "Browser origins allowed to call this API cross-origin (API Gateway's native CORS support)"
  type        = list(string)
  default     = ["https://gin-rummy.peteshepley.com", "http://localhost:5173"]
}

variable "ws_domain_name" {
  description = "Custom domain for the relay's WebSocket API"
  type        = string
  default     = "gin-rummy.ws.peteshepley.com"
}

variable "ws_root_domain_name" {
  description = "Root domain whose wildcard ACM cert covers ws_domain_name"
  type        = string
  default     = "ws.peteshepley.com"
}

variable "site_bucket_name" {
  description = "Globally unique name for the S3 bucket that stores the built web client"
  type        = string
  default     = "peteshepley-gin-rummy-app-site"
}

variable "domain_name" {
  description = "Custom domain aliased to the web client's CloudFront distribution"
  type        = string
  default     = "gin-rummy.peteshepley.com"
}

variable "root_domain_name" {
  description = "Root domain whose wildcard ACM cert covers domain_name"
  type        = string
  default     = "peteshepley.com"
}