# Legal bases and purposes (Records of Processing)

The municipality is data controller for all citizen data in its data plane. The vendor is
data processor only for Model B (isolated hosting); for Model C the vendor processes no
production personal data.

## Processing register (per module)

| Processing                  | Purpose                                                        | Legal basis (GDPR)                         | National basis                       | Data categories                                                            |
| --------------------------- | -------------------------------------------------------------- | ------------------------------------------ | ------------------------------------ | -------------------------------------------------------------------------- |
| LSS case handling support   | Structure/quality-assure decisions, hours, providers, payments | Art. 6(1)(e); Art. 9(2)(b) for health data | LSS (1993:387), SoL                  | Identity, decisions, need assessments (health), hours, providers, payments |
| Economic assistance support | Structure households, income, housing, payments                | Art. 6(1)(e)                               | SoL (2001:453) 4 kap.                | Identity, household, income, housing, payments                             |
| UBM request handling        | Answer statutory requests from Utbetalningsmyndigheten         | Art. 6(1)(c)                               | Lag (2023:456) om uppgiftsskyldighet | Data covered by the request, minimized per eligibility engine              |
| Payment control             | Detect/stop incorrect payments                                 | Art. 6(1)(e)                               | Kommunallagen, SoL/LSS               | Payments, recipients, accounts (masked by default)                         |
| Audit & data access logging | Security, internal secrecy supervision                         | Art. 6(1)(c),(e)                           | OSL, säkerhetskrav                   | User ids, access events, reasons                                           |
| Archive/retention           | Statutory archiving                                            | Art. 6(1)(c)                               | Arkivlagen                           | All of the above per retention schedule                                    |

## Principles enforced in code

- **Data minimization:** UBM eligibility question 9 blocks non-necessary data; schema
  validation rejects unknown fields.
- **Purpose limitation:** purposes recorded per income record/export; purpose-bound
  access tables for extraordinary access.
- **Storage limitation:** retention rules + legal holds + disposal decisions with
  maker-checker.
- **Integrity/confidentiality:** RLS, masking by default, reason-required reveals,
  hash-chained audit logs.

## Data subject rights

`data_subject_requests` tracks access/rectification/erasure/restriction/portability/
objection with statutory due dates. Erasure respects archive law (arkivlagen) precedence.
