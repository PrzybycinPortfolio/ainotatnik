-- Let users delete their own conversations; messages go with them via ON DELETE CASCADE.
create policy "conversations: delete own" on conversations for delete using ((select auth.uid()) = user_id);
