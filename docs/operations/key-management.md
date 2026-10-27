# Key management (real key service)

Added in package S26 (register item M18). Protected profile fields and other protected values are encrypted with data keys; the data keys are themselves wrapped. Until now they were wrapped with a master key held in an environment variable, which is fine for the pilot and not for real data. This moves the wrapping to AWS KMS, where the master key never leaves the service.

## What changes and what does not

- Encrypted values do not change. The data keys do not change. Only the wrapping of each data key moves from the local key to KMS.
- New data keys are wrapped by KMS from the first write after the switch.
- Every wrap and open call carries a context (the purpose and the data key's version), so a wrapped key copied to another version fails to open.
- Commercial mode still refuses the plain local provider. The `realKeyManagement` readiness check becomes true only when `KMS_PROVIDER=aws_kms`, the key id and region are set, and a live test (wrap and open a throwaway key) has just passed.

## Owner steps (O16)

1. Create the key and policy: `bash scripts/ops/aws-kms-setup.sh us-east-1` with the AWS CLI signed in. It prints the key id, the key ARN and the policy ARN.
2. In IAM create a user that has only that policy, and make an access key for it.
3. In Vercel set, for the production environment only: `KMS_PROVIDER=aws_kms`, `KMS_KEY_ID` (the alias or the key ARN), `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`. Keep `KMS_LOCAL_MASTER_KEY_BASE64` for now: it is used only to open data keys not yet moved.
4. Redeploy. The migration `0093_data_key_wrapping_id` must have run first (it adds the column that records which key wrapped each data key).
5. Move the existing data keys: call `GET /api/jobs/rewrap-data-keys` with the header `Authorization: Bearer <CRON_SECRET>`. It answers with counts: `rewrapped`, `remaining`, `failed`. Run it again until `remaining` is 0. It is safe to run any number of times.
6. When `remaining` is 0 and the Platform overview shows the key service check as passing, remove `KMS_LOCAL_MASTER_KEY_BASE64` from Vercel and redeploy. Keep an offline copy of the old local key until you have confirmed a protected value still opens.

## If something is wrong

- The key service check fails: the Platform overview shows "real key management" as not satisfied. Check the key id, region, and that the IAM user has the policy.
- Protected fields report "encryption unavailable": the settings are incomplete. The application never falls back to the local key when `KMS_PROVIDER=aws_kms`.
- To go back before step 6: set `KMS_PROVIDER=local` (the local key still opens everything it wrapped; keys already moved to KMS stay unreadable until you switch back).

## Costs and limits

KMS charges per key per month and per request. Data keys are opened once per server instance and remembered in memory, so requests are few. Key rotation is enabled on the key (annual, automatic, transparent to wrapped data).
