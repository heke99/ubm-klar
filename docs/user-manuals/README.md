# Användarhandledningar (pilot)

Handledningarna beskriver den faktiska produkten i kundpilotläget. Alla flöden
kräver inloggning; vad du ser styrs av din roll och kontrolleras alltid i
backend.

## Kom igång

1. Gå till kommunens adress (t.ex. `dinkommun.ubmklar.se`) och logga in med
   organisationens konto (Entra ID/SSO). Okända adresser avvisas (421).
2. Navigationen visar de områden din roll får använda. Gula bannern
   "Kundpilotläge" betyder att officiell UBM-överföring är avstängd och att
   fullständiga produktionsdata inte ska importeras före godkända grindar.

## Importera data (roller: controller, ekonom)

1. **Importer → Starta ny import**: välj fil (CSV/XLSX), importtyp och
   källsystem. Systemspecifika adaptrar som inte är klara går inte att välja —
   använd generisk CSV/XLSX-export.
2. **Mappning**: koppla filens kolumner till målfälten (personnummer, belopp,
   datum osv.). Spara mappningen.
3. **Validera**: fel (ogiltiga personnummer, negativa belopp, dubbletter,
   perioder baklänges) visas per rad med tydliga texter. Endast felfria rader
   kan läsas in.
4. **Läs in**: inläsningen är transaktionell och spårbar (varje rad kopplas
   till det den skapade). Samma fil kan inte läsas in två gånger. Före
   inläsning kan batchen återställas helt.

## UBM-förfrågningar (roller: UBM-ansvarig, jurist, DPO)

1. **UBM-förfrågningar → Registrera ny förfrågan**: ärendenummer, datum,
   frist, område, efterfrågade uppgifter.
2. **Koppla person**: sök på personnummer — matchning visas med säkerhet och
   skäl; sökningen loggas alltid.
3. **Granskningar**: jurist och DPO registrerar sina beslut på förfrågan.
4. **Lämplighetsprövning + exportförslag**: systemet prövar de 27 frågorna mot
   verkliga data. Blockerade förslag förklarar exakt varför.
5. **Fyra ögon**: den som skapade förslaget kan aldrig godkänna det. Efter
   godkännande paketeras exporten (zip med manifest, kontrollsummor och
   sammanfattning), laddas ner (loggas), skickas manuellt och kvitteras.

## Betalningskontroll och kontrollärenden (roller: controller, utredare)

- **Betalningskontroll → Kör regler nu**: 25 LSS- eller 25 EB-regler körs mot
  kommunens importerade data. Flaggor med hög/kritisk allvarlighetsgrad blir
  kontrollärenden automatiskt.
- **Kontrollärenden**: öppna ärendet för flaggor, händelsekedja och
  anteckningar; tilldela, utred och registrera utfall (stoppa utbetalning,
  återkrav, polisanmälan m.m.). Allt loggas.

## Underrättelser (roller: UBM-ansvarig, utredare)

Registrera inkommande underrättelser manuellt, matcha mot person (loggas),
skapa kontrollärende och registrera utfall. Återrapportering sker manuellt —
ingen officiell kanal finns.

## Dokument (roller: handläggare, jurist)

Ladda upp med klassificering (virusskannas — smittade filer sparas aldrig).
Känsliga klasser (känslig/medicinsk/skyddad identitet/barn) kräver skäl för att
öppnas; all åtkomst loggas. Textdokument kan maskas automatiskt med verifiering;
maskade kopior lagras separat.

## Rapporter

14 rapporter över verkliga data (beredskap, frister, risker, ärenden,
datakvalitet, åtkomster, go-live, pilotutfall) med CSV/XLSX/JSON-export.
Rapporter din roll inte får se kan inte köras.

## Revision och loggar (roller: revisor, DPO, säkerhetsansvarig)

`Revision och loggar` visar den hash-kedjade revisionsloggen och
dataåtkomstloggen med filter. Beviskedjan verifieras direkt på sidan — en röd
varning betyder möjlig manipulation och ska eskaleras omedelbart.

## Administration (roller: kommunadmin, systemägare)

- **Inställningar → Användare och roller**: tilldela/återkalla roller (skäl
  krävs, allt loggas) och granska leverantörens support-/nödåtkomst.
- **Inställningar → Bakgrundsjobb**: kö, omkörningar och dead letter.
- **Onboarding**: pilot- och produktionsgrindar med dispenshantering.
