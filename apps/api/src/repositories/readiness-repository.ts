import type { DbClient } from '@ubm-klar/db';

export interface ReadinessGateWithEvidence {
  gateKey: string;
  titleSv: string;
  descriptionSv: string;
  required: boolean;
  gateOrder: number;
  status: 'not_started' | 'in_progress' | 'passed' | 'failed' | 'waived';
  evidenceKind: string | undefined;
  evidenceReference: string | undefined;
  waiverMotivation: string | undefined;
}

export class ReadinessRepository {
  constructor(private readonly db: DbClient) {}

  async listGates(): Promise<ReadinessGateWithEvidence[]> {
    const result = await this.db.query<{
      gate_key: string;
      title_sv: string;
      description_sv: string;
      required: boolean;
      gate_order: number;
      status: string | null;
      evidence_kind: string | null;
      evidence_reference: string | null;
      waiver_motivation: string | null;
    }>(
      `select g.gate_key, g.title_sv, g.description_sv, g.required, g.gate_order,
              e.status, e.evidence_kind, e.evidence_reference, e.waiver_motivation
       from production_readiness_gates g
       left join production_readiness_evidence e on e.gate_key = g.gate_key
       order by g.gate_order`,
    );
    return result.rows.map((row) => ({
      gateKey: row.gate_key,
      titleSv: row.title_sv,
      descriptionSv: row.description_sv,
      required: row.required,
      gateOrder: row.gate_order,
      status: (row.status ?? 'not_started') as ReadinessGateWithEvidence['status'],
      evidenceKind: row.evidence_kind ?? undefined,
      evidenceReference: row.evidence_reference ?? undefined,
      waiverMotivation: row.waiver_motivation ?? undefined,
    }));
  }

  async upsertGate(input: {
    gateKey: string;
    titleSv: string;
    descriptionSv: string;
    required: boolean;
    gateOrder: number;
  }): Promise<void> {
    await this.db.query(
      `insert into production_readiness_gates (gate_key, title_sv, description_sv, required, gate_order)
       values ($1, $2, $3, $4, $5)
       on conflict (gate_key) do update
         set title_sv = excluded.title_sv,
             description_sv = excluded.description_sv,
             required = excluded.required,
             gate_order = excluded.gate_order`,
      [input.gateKey, input.titleSv, input.descriptionSv, input.required, input.gateOrder],
    );
  }

  async setEvidence(input: {
    gateKey: string;
    status: 'not_started' | 'in_progress' | 'passed' | 'failed' | 'waived';
    evidenceKind?: 'test_run' | 'document' | 'attestation' | 'configuration' | 'external_reference';
    evidenceReference?: string;
    verifiedBy?: string;
    waiverMotivation?: string;
  }): Promise<void> {
    await this.db.query(
      `insert into production_readiness_evidence
         (gate_key, status, evidence_kind, evidence_reference, verified_by, waiver_motivation)
       values ($1, $2, $3, $4, $5::uuid, $6)
       on conflict (gate_key) do update
         set status = excluded.status,
             evidence_kind = excluded.evidence_kind,
             evidence_reference = excluded.evidence_reference,
             verified_by = excluded.verified_by,
             waiver_motivation = excluded.waiver_motivation,
             updated_at = now()`,
      [
        input.gateKey,
        input.status,
        input.evidenceKind ?? null,
        input.evidenceReference ?? null,
        input.verifiedBy ?? null,
        input.waiverMotivation ?? null,
      ],
    );
  }

  /** Go-live is blocked while any required gate is neither passed nor waived. */
  async goLiveStatus(): Promise<{
    allowed: boolean;
    openRequiredGates: string[];
    waivedGates: string[];
  }> {
    const gates = await this.listGates();
    const required = gates.filter((g) => g.required);
    const open = required.filter((g) => g.status !== 'passed' && g.status !== 'waived');
    return {
      allowed: open.length === 0 && required.length > 0,
      openRequiredGates: open.map((g) => g.gateKey),
      waivedGates: gates.filter((g) => g.status === 'waived').map((g) => g.gateKey),
    };
  }
}
