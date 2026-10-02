-- Every invoice counts as a business cost unless the user excludes it
-- (invoices.excluded). The AI business/private classification step is gone.

alter table invoices alter column is_business set default true;

-- Earlier invoices were classified by AI, which without a business
-- description defaulted to "private". Bring them in line with the new rule;
-- invoices the user excluded keep excluded = true and stay out of KUP.
update invoices
set is_business = true,
    classification_reason = 'Domyślnie uznana za firmową — wyklucz ją, jeśli to wydatek prywatny.'
where is_business is distinct from true;
