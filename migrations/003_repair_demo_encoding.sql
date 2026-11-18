BEGIN;
UPDATE venues SET name = 'Cơ sở 1 - Cầu Giấy', name_i18n = '{"vi":"Cơ sở 1 - Cầu Giấy","en":"Cau Giay Venue 1"}'::jsonb,
 address = 'Số 18 đường Cầu Giấy, Dịch Vọng, Cầu Giấy, Hà Nội',
 address_i18n = '{"vi":"Số 18 đường Cầu Giấy, Dịch Vọng, Cầu Giấy, Hà Nội","en":"18 Cau Giay St, Dich Vong, Cau Giay, Hanoi"}'::jsonb
WHERE id = 'b0000000-0000-0000-0000-000000000001' AND name LIKE '%Æ%';
UPDATE tenants SET name = 'Sân Thể Thao Phù Đổng' WHERE id = 'a0000000-0000-0000-0000-000000000001' AND name LIKE '%Ã%';
UPDATE courts SET name = 'Sân 5A', name_i18n = '{"vi":"Sân 5A","en":"Court 5A"}'::jsonb WHERE venue_id = 'b0000000-0000-0000-0000-000000000001' AND name = 'SÃ¢n 5A';
UPDATE courts SET name = 'Sân 5B', name_i18n = '{"vi":"Sân 5B","en":"Court 5B"}'::jsonb WHERE venue_id = 'b0000000-0000-0000-0000-000000000001' AND name = 'SÃ¢n 5B';
UPDATE courts SET name = 'Sân 7A (Ghép)', name_i18n = '{"vi":"Sân 7A (Ghép)","en":"Court 7A (Composite)"}'::jsonb WHERE venue_id = 'b0000000-0000-0000-0000-000000000001' AND name = 'SÃ¢n 7A (GhÃ©p)';
UPDATE policies SET policy_i18n = '{"vi": "Hủy trước 24h hoàn 100% tiền cọc, trước 12h hoàn 50%, dưới 12h mất cọc.", "en": "Cancel 24h+ before start for 100% deposit refund, 12-24h for 50%, under 12h forfeits deposit."}'::jsonb WHERE venue_id = 'b0000000-0000-0000-0000-000000000001';
UPDATE tenants SET bank_account_info = '{"bank_id":"MB","account_number":"0912345678","account_name":"SAN THE THAO PHU DONG"}'::jsonb WHERE id = 'a0000000-0000-0000-0000-000000000001' AND (bank_account_info IS NULL OR bank_account_info = '{}'::jsonb);
COMMIT;
