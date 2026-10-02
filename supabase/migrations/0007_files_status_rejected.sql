-- 'rejected': the uploaded document is not an invoice/receipt (checked during
-- extraction). No invoice row is created and the stored object is removed.
alter table files drop constraint files_status_check;
alter table files add constraint files_status_check
  check (status = any (array['pending', 'processing', 'done', 'error', 'rejected']));
