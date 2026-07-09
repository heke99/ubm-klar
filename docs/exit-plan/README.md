# Exit Plan

The municipality always owns its data and can leave UBM Klar with a complete,
verifiable export. Exit capability is proven **before go-live**, not at exit:
the production readiness gate `exit_export_tested` requires a successful test
export during onboarding.

## What the exit export contains

Thirteen dataset scopes covering everything the platform stores for the
municipality: structured case data, documents with metadata, audit and data
access logs, UBM exports and receipts, control cases, rule configurations,
import history, mappings, source record links, data lineage and the evidence
chain. Formats and checksums are specified in
[exit-appendix.md](exit-appendix.md).

## Process summary

1. The municipality requests exit; the exit export requires maker-checker
   approval (the requester can never approve it alone).
2. The vendor produces the package; the municipality verifies the manifest and
   per-file checksums with `verifyExitExport`.
3. After written confirmation, the vendor deletes all copies (Model B) and
   certifies deletion. Control-plane metadata is anonymised to statistics.
4. Delivery deadline: 30 days from request (see the appendix for transition
   arrangements).

## Pilot note

During a customer pilot the automated exit-export job family is not yet
implemented in the worker (it fails explicitly with `NOT_IMPLEMENTED` rather
than pretending success). Exit capability for pilot tenants is fulfilled by the
release tooling: the data plane is the municipality's own Postgres database and
can be exported in full with standard tooling (`pg_dump`), plus document
storage buckets. The engine (exit-export scopes, manifest and verification
logic in `@ubm-klar/archive-engine`) is implemented and tested; wiring the
automated end-to-end job is a production go-live requirement tracked by the
`exit_export_tested` gate.
