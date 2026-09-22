-- Admins may read orders and payments.
--
-- `orders_select_own` and `payments_select_own` are exactly right for a member
-- — you see your own invoices and nobody else's — and they meant the revenue
-- console returned zero for everything. Not an error: zero. A page that says
-- "₹0 this month" when the month had sales is worse than one that fails,
-- because nobody investigates a number that looks plausible.
--
-- This is the third time the same shape has turned up in this schema
-- (lesson_progress, enrollments, and now billing): a policy written for the
-- member case, with no admin counterpart, producing a console that is
-- confidently empty. The pattern to watch for is `*_select_own` on any table
-- an admin screen reads.
--
-- Read only, for the same reason as the others. An admin needs to *see* what
-- somebody paid; an admin who could write a payment row could manufacture a
-- membership, and the whole point of reconciling against the provider is that
-- the database is not the authority on money.

begin;

drop policy if exists orders_admin_read on public.orders;
create policy orders_admin_read on public.orders
  for select to authenticated
  using (public.is_admin());

drop policy if exists payments_admin_read on public.payments;
create policy payments_admin_read on public.payments
  for select to authenticated
  using (public.is_admin());

commit;
