BEGIN;
-- Remove only the known demo fixture; preserve all other owner configurations.
UPDATE tenants SET bank_account_info = '{}'::jsonb
WHERE id = 'a0000000-0000-0000-0000-000000000001'
AND bank_account_info = jsonb_build_object('bank_id', 'MB', 'account_number', '0912345678', 'account_name', 'SAN THE THAO PHU DONG');
COMMIT;
