# Sets global variables for this Terraform project.


variable app_name {
  default = "bootmicro"
}

variable location {
  default = "eastus"
}

variable kubernetes_version {    
  default = "1.34.1"
}

variable "azure_subscription_id" {
  type=string
}
