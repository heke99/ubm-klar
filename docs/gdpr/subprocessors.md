# Underbiträdesförteckning (mall)

| Underbiträde | Tjänst | Behandlingsort | Data | Skyddsåtgärd |
| --- | --- | --- | --- | --- |
| [Molnleverantör databas/lagring] | Isolerad dataplan (Modell B) | EU/EES | Kommunens data plane | DPA, EU-region, kryptering |
| [E-postleverantör] | Tekniska aviseringar | EU/EES | Endast tjänste-e-post, ingen PII | DPA |
| [SIEM-leverantör, om leverantörsdriven] | Teknisk logg | EU/EES | No-PII tekniska händelser | DPA, no-PII-guard |

Regler:

- Inga underbiträden utanför EU/EES utan giltig överföringsmekanism och kommunens
  godkännande.
- AI-leverantörer får aldrig ta emot personuppgifter utan uttryckligt kommungodkännande
  och en dataplan som stödjer det (`ai_model_configurations.pii_in_prompts_allowed`).
- Förteckningen versioneras; ändringar meddelas kommunen i förväg.
