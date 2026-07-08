# Moln- och utkontrakteringsunderlag

Underlag för kommunens bedömning enligt OSL, säkerhetsskydd och it-driftsutredningens
principer.

## Sekretess och röjandefrågan

- Modell C: uppgifterna lämnar aldrig kommunens drift — ingen utkontraktering av
  personuppgiftsbehandling sker.
- Modell B: uppgifter behandlas av leverantören som biträde i isolerad dataplan inom
  EU/EES; teknisk och organisatorisk åtkomstbegränsning (no-PII support, JIT, loggning)
  minimerar röjanderisk. Kommunen gör den slutliga OSL-bedömningen; DPIA- och
  PUB-mallar medföljer.

## Tredjelandsöverföring

Ingen tredjelandsöverföring i standardutförande. Underbiträden inom EU/EES
(se subprocessors.md). AI-funktioner är avstängda som standard och tar aldrig emot PII
utan uttryckligt godkännande.

## Säkerhetsskydd

UBM Klar hanterar inte säkerhetsskyddsklassificerade uppgifter. Om sådana identifieras
ska de inte läggas in i systemet (guardrail: `security_classified` klass blockeras för
AI och kräver särskild hantering).

## Beroenden och inlåsning

- Öppna format i exitexport (JSON Lines, originalfiler, manifest med SHA-256)
- Migrationspaket och schema medföljer varje release
- Modell C ger kommunen fullt infrastrukturägande från dag ett
