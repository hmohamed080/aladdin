-- Performance: evaluate the platform-staff RLS check once per statement, not per row.
--
-- Twenty SELECT policies grant platform support staff read access with the bare
-- expression `app.is_platform('support')`. The argument is a constant, so the answer
-- cannot differ between rows, but Postgres still called the function (and its
-- admin-rank lookup) for every row the scan visited. Hosted staging measured the
-- service-area read at ~260 ms mean (pg_stat_statements, 1,292 calls) for ~1,000 rows,
-- almost all of it in this per-row call. Wrapping the call in a scalar sub-select makes
-- it an InitPlan, computed once per statement — the same pattern the policies already
-- use for `(select auth.uid())`.
--
-- Security is unchanged: identical expression, identical role, identical command;
-- only the evaluation count changes. Every other policy is untouched.
-- Rollback: re-run each statement with the bare `app.is_platform(...)` expression.

alter policy job_applications_select_platform on public.job_applications using ((select app.is_platform('support'::public.platform_role)));
alter policy job_assignments_select_platform on public.job_assignments using ((select app.is_platform('support'::public.platform_role)));
alter policy job_progress_select_platform on public.job_progress_updates using ((select app.is_platform('support'::public.platform_role)));
alter policy jobs_select_platform on public.jobs using ((select app.is_platform('support'::public.platform_role)));
alter policy netcand_select_platform on public.network_candidates using ((select app.is_platform('support'::public.platform_role)));
alter policy orders_select_platform on public.orders using ((select app.is_platform('support'::public.platform_role)));
alter policy org_co_owners_select_platform on public.org_co_owners using ((select app.is_platform('support'::public.platform_role)));
alter policy products_select_platform on public.products using ((select app.is_platform('support'::public.platform_role)));
alter policy projects_select_platform on public.projects using ((select app.is_platform('support'::public.platform_role)));
alter policy publishers_select_platform on public.publishers using ((select app.is_platform('support'::public.platform_role)));
alter policy pr_select_platform on public.purchase_requests using ((select app.is_platform('support'::public.platform_role)));
alter policy quotations_select_platform on public.quotations using ((select app.is_platform('support'::public.platform_role)));
alter policy rfqs_select_platform on public.rfqs using ((select app.is_platform('support'::public.platform_role)));
alter policy saved_products_select_platform on public.saved_products using ((select app.is_platform('support'::public.platform_role)));
alter policy trade_specialties_select_platform on public.trade_specialties using ((select app.is_platform('support'::public.platform_role)));
alter policy trades_select_platform on public.trades using ((select app.is_platform('support'::public.platform_role)));
alter policy user_availability_windows_select_platform on public.user_availability_windows using ((select app.is_platform('support'::public.platform_role)));
alter policy user_service_areas_select_platform on public.user_service_areas using ((select app.is_platform('support'::public.platform_role)));
alter policy user_trade_specialties_select_platform on public.user_trade_specialties using ((select app.is_platform('support'::public.platform_role)));
alter policy user_trades_select_platform on public.user_trades using ((select app.is_platform('support'::public.platform_role)));
