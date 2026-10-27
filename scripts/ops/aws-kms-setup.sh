#!/bin/bash
# Creates the one AWS KMS key VisaStack uses to wrap its data keys, and a least-privilege policy
# for the application user. Run it yourself with the AWS CLI signed in to the account that will
# own the key (owner action O16). It prints ids only, never a secret.
#
# usage: bash scripts/ops/aws-kms-setup.sh [region]
set -euo pipefail
REGION="${1:-us-east-1}"
ALIAS="alias/visastack-data-keys"

KEY_ID="$(aws kms create-key \
  --region "$REGION" \
  --description 'VisaStack data key wrapping' \
  --key-usage ENCRYPT_DECRYPT \
  --key-spec SYMMETRIC_DEFAULT \
  --tags TagKey=app,TagValue=visastack \
  --query 'KeyMetadata.KeyId' --output text)"
aws kms create-alias --region "$REGION" --alias-name "$ALIAS" --target-key-id "$KEY_ID"
aws kms enable-key-rotation --region "$REGION" --key-id "$KEY_ID"
KEY_ARN="$(aws kms describe-key --region "$REGION" --key-id "$KEY_ID" --query 'KeyMetadata.Arn' --output text)"

POLICY_FILE="$(mktemp)"
cat > "$POLICY_FILE" <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "VisaStackWrapAndOpenDataKeys",
      "Effect": "Allow",
      "Action": ["kms:Encrypt", "kms:Decrypt"],
      "Resource": "$KEY_ARN",
      "Condition": {
        "StringEquals": { "kms:EncryptionContext:purpose": "visastack:data-key" }
      }
    }
  ]
}
JSON
POLICY_ARN="$(aws iam create-policy --policy-name visastack-kms-wrap \
  --policy-document "file://$POLICY_FILE" --query 'Policy.Arn' --output text)"
rm -f "$POLICY_FILE"

echo "Region:      $REGION"
echo "Key id:      $KEY_ID   (use KMS_KEY_ID=$ALIAS or the key ARN below)"
echo "Key ARN:     $KEY_ARN"
echo "Policy ARN:  $POLICY_ARN"
echo
echo "Next: create an IAM user with only this policy, make an access key for it, and give Vercel"
echo "AWS_REGION, KMS_KEY_ID, AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY. See docs/operations/key-management.md."
