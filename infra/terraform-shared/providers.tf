terraform {
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.55.0"
    }
  }

  required_version = ">= 1.5.7, <2.0.0"
}

provider "azurerm" {
  subscription_id = var.azure_subscription_id
  features {}
}
