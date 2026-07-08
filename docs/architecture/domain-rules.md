# Domain and Brand Rules

The tenant resolver is strict and fails closed: unknown domains resolve to nothing and the
request is rejected. Tenant configuration must never leak across tenants.

## Allowed — Model B (vendor-hosted)

Subdomains of `ubmklar.se`, optionally with an environment suffix:

- `malmo.ubmklar.se`
- `helsingborg.ubmklar.se`
- `landskrona.ubmklar.se`
- `malmo-test.ubmklar.se`
- `malmo-stage.ubmklar.se`

## Allowed — Model C (municipality-owned)

Subdomains of a domain the municipality owns:

- `ubm-klar.malmo.se`
- `ubm-klar.helsingborg.se`
- `ubm-klar.landskrona.se`

## Forbidden

Domains that imply the product is Utbetalningsmyndigheten or another authority:

- `malmo.ubm.se`, `helsingborg.ubm.se` or anything under `ubm.se`
- anything under `utbetalningsmyndigheten.se`
- government-looking domains not owned by the municipality

The resolver rejects forbidden domains even if someone registers them in the control plane
(defence in depth, see `@ubm-klar/tenant-resolver`).

## UI copy

- Product name: **UBM Klar**
- Tagline: *"UBM Klar hjälper kommunen att strukturera, kvalitetssäkra, kontrollera och förbereda uppgifter inför UBM-processer."*
- Mandatory disclaimer on every UI surface: *"UBM Klar är en fristående produkt och är inte en tjänst från Utbetalningsmyndigheten eller någon annan myndighet."*
- No authority logos, no "myndighet" phrasing about the product itself, no domains or copy
  implying the vendor is Utbetalningsmyndigheten.
