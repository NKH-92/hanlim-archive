-- 시크릿 등록 시 줄바꿈이 포함된 초기 release smoke 자격증명을 새 무작위 값으로 회전한다.
UPDATE app_users
SET password_salt = '4knSxH1j7Fz_1nu5QH5IXw',
    password_hash = 'dF4FzonzBKlPtDFhz68U54FGFyl7XRie7J-qj8anemw',
    updated_at = CURRENT_TIMESTAMP
WHERE username = 'release-smoke@hanlim.internal'
  AND status = 'approved'
  AND role = 'User'
  AND can_manage_documents = 0
  AND can_move_documents = 0
  AND can_manage_disposals = 0
  AND can_manage_sets = 0
  AND can_manage_masters = 0
  AND can_manage_users = 0
  AND can_view_audit = 0;
