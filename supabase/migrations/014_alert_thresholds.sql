-- Default alert thresholds and window
insert into app_settings (key, value) values
  ('AUTH_FAIL_THRESHOLD', '100') on conflict (key) do nothing;
insert into app_settings (key, value) values
  ('RATE_LIMIT_THRESHOLD', '50') on conflict (key) do nothing;
insert into app_settings (key, value) values
  ('ALERT_WINDOW_MINUTES', '60') on conflict (key) do nothing;
