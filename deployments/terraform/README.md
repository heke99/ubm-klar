# Terraform (Model B provisioning)

Modules to provision one isolated Supabase project per municipality per environment,
DNS records under `ubmklar.se`, per-tenant secret entries
(`DATA_PLANE_SERVICE_KEY__<SLUG>__<ENV>`) and backup schedules.

State is segregated per tenant (one workspace per municipality) so that a plan/apply can
never touch more than one municipality's infrastructure.
