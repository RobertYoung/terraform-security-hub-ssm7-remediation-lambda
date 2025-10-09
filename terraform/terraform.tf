terraform {
  backend "s3" {
    bucket = "terraform-iamrobertyoung"
    key    = "security-admin/tfstate.json"
    region = "eu-west-1"
  }
}
