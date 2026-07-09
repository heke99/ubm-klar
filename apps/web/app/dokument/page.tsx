import { Card, MaskedValue, StatusBadge } from '../../design-system/components';

export const dynamic = 'force-static';

/** Dokument: dokumentvalv med klassning, maskning och exportgodkännande. */
export default function DokumentPage() {
  return (
    <>
      <h1>Dokument</h1>
      <Card title="Dokumentvalv">
        <p>
          Dokument lagras krypterat i kommunens egen lagring med metadata, filhash,
          skadeprogramsskanning och klassificering. Medicinska dokument, skyddad identitet och barns
          handlingar kräver förhöjd behörighet och skäl vid öppning. All åtkomst loggas.
        </p>
        <p>
          Vid UBM-export skickas <strong>dokumentreferenser först</strong>; fullständiga dokument
          endast efter uttryckligt exportgodkännande, och känsliga dokument maskas före export.
        </p>
      </Card>
      <Card title="Exempel på maskering">
        <table>
          <caption>Dokument i ärende (demo)</caption>
          <thead>
            <tr>
              <th scope="col">Dokument</th>
              <th scope="col">Klass</th>
              <th scope="col">Personnummer</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Läkarintyg 2026-05-02</td>
              <td>
                <StatusBadge status="Medicinskt" tone="danger" />
              </td>
              <td>
                <MaskedValue maskedValue="1981••••••••" />
              </td>
              <td>
                <StatusBadge status="Kräver förhöjd behörighet" tone="warning" />
              </td>
            </tr>
            <tr>
              <td>Hyresavi juni 2026</td>
              <td>
                <StatusBadge status="Känsligt" tone="warning" />
              </td>
              <td>
                <MaskedValue maskedValue="••••••••" />
              </td>
              <td>
                <StatusBadge status="Referens kan skickas" tone="info" />
              </td>
            </tr>
          </tbody>
        </table>
      </Card>
    </>
  );
}
