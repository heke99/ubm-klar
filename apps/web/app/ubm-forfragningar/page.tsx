import { Card, EmptyState, StatusBadge } from '../../design-system/components';
import { demo } from '../../components/demo-data';

export const dynamic = 'force-static';

/** UBM-förfrågningar: intag, matchning och handläggningsflöde. */
export default function UbmForfragningarPage() {
  const requests = demo.lss.ubmRequestIds;
  return (
    <>
      <h1>UBM-förfrågningar</h1>
      <Card title="Flöde">
        <ol>
          <li>Registrera förfrågan (manuellt eller filuppladdning).</li>
          <li>Validera och matcha mot person/ärende/område.</li>
          <li>Samla underlag och kontrollera datalinje och klassning.</li>
          <li>Kör behörighetsbedömning (27 kontrollfrågor).</li>
          <li>Skapa exportförslag och skicka till granskning.</li>
          <li>Fyra-ögon-godkännande, paketera, leverera via godkänd kanal, registrera kvittens.</li>
        </ol>
      </Card>
      <Card title="Öppna förfrågningar (demo)">
        {requests.length === 0 ? (
          <EmptyState
            message="Inga öppna förfrågningar."
            action="Registrera en ny förfrågan med knappen ovan när en förfrågan tas emot."
          />
        ) : (
          <table>
            <caption>Öppna UBM-förfrågningar</caption>
            <thead>
              <tr>
                <th scope="col">Förfrågan</th>
                <th scope="col">Område</th>
                <th scope="col">Status</th>
                <th scope="col">Nästa steg</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((id, index) => (
                <tr key={id}>
                  <td>{id}</td>
                  <td>{index % 2 === 0 ? 'LSS' : 'Ekonomiskt bistånd'}</td>
                  <td>
                    <StatusBadge
                      status={
                        index % 3 === 0
                          ? 'Validerad'
                          : index % 3 === 1
                            ? 'Matchning pågår'
                            : 'Underlag samlas'
                      }
                      tone={index % 3 === 0 ? 'success' : 'info'}
                    />
                  </td>
                  <td>{index % 3 === 0 ? 'Skapa exportförslag' : 'Fortsätt handläggning'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
