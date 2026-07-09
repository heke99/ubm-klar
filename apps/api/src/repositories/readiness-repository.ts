import type { DbClient } from '@ubm-klar/db';

export type GateScope = 'pilot' | 'production' | 'both';

export interface ReadinessGateWithEvidence {
  gateKey: string;
  titleSv: string;
  descriptionSv: string;
  required: boolean;
  gateOrder: number;
  scope: GateScope;
  status: 'not_started' | 'in_progress' | 'passed' | 'failed' | 'waived';
  evidenceKind: string | undefined;
  evidenceReference: string | undefined;
  waiverMotivation: string | undefined;
  waiverApprovedBy: string | undefined;
  waiverExpiresAt: string | undefined;
  waiverRiskLevel: string | undefined;
}

export interface WaiverInput {
  gateKey: string;
  reason: string;
  approverProfileId: string;
  expiresAt: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

export class WaiverValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WaiverValidationError';
  }
}

export class ReadinessRepository {
  constructor(private readonly db: DbClient) {}

  async listGates(scope?: 'pilot' | 'production'): Promise<ReadinessGateWithEvidence[]> {
    const scopeClause = scope ? `where g.scope = $1 or g.scope = 'both'` : '';
    const result = await this.db.query<{
      gate_key: string;
      title_sv: string;
      description_sv: string;
      required: boolean;
      gate_order: number;
      scope: GateScope;
      status: string | null;
      evidence_kind: string | null;
      evidence_reference: string | null;
      waiver_motivation: string | null;
      waiver_approved_by: string | null;
      waiver_expires_at: Date | null;
      waiver_risk_level: string | null;
    }>(
      `select g.gate_key, g.title_sv, g.description_sv, g.required, g.gate_order, g.scope,
              e.status, e.evidence_kind, e.evidence_reference, e.waiver_motivation,
              e.waiver_approved_by, e.waiver_expires_at, e.waiver_risk_level
       from production_readiness_gates g
       left join production_readiness_evidence e on e.gate_key = g.gate_key
       ${scopeClause}
       order by g.gate_order`,
      scope ? [scope] : [],
    );
    return result.rows.map((row) => ({
      gateKey: row.gate_key,
      titleSv: row.title_sv,
      descriptionSv: row.description_sv,
      required: row.required,
      gateOrder: row.gate_order,
      scope: row.scope,
      status: (row.status ?? 'not_started') as ReadinessGateWithEvidence['status'],
      evidenceKind: row.evidence_kind ?? undefined,
      evidenceReference: row.evidence_reference ?? undefined,
      waiverMotivation: row.waiver_motivation ?? undefined,
      waiverApprovedBy: row.waiver_approved_by ?? undefined,
      waiverExpiresAt: row.waiver_expires_at
        ? row.waiver_expires_at.toISOString().slice(0, 10)
        : undefined,
      waiverRiskLevel: row.waiver_risk_level ?? undefined,
    }));
  }

  async upsertGate(input: {
    gateKey: string;
    titleSv: string;
    descriptionSv: string;
    required: boolean;
    gateOrder: number;
    scope?: GateScope;
  }): Promise<void> {
    await this.db.query(
      `insert into production_readiness_gates (gate_key, title_sv, description_sv, required, gate_order, scope)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (gate_key) do update
         set title_sv = excluded.title_sv,
             description_sv = excluded.description_sv,
             required = excluded.required,
             gate_order = excluded.gate_order,
             scope = excluded.scope`,
      [
        input.gateKey,
        input.titleSv,
        input.descriptionSv,
        input.required,
        input.gateOrder,
        input.scope ?? 'production',
      ],
    );
  }

  async setEvidence(input: {
    gateKey: string;
    status: 'not_started' | 'in_progress' | 'passed' | 'failed';
    evidenceKind?: 'test_run' | 'document' | 'attestation' | 'configuration' | 'external_reference';
    evidenceReference?: string;
    verifiedBy?: string;
  }): Promise<void> {
    await this.db.query(
      `insert into production_readiness_evidence
         (gate_key, status, evidence_kind, evidence_reference, verified_by,
          waiver_motivation, waiver_approved_by, waiver_expires_at, waiver_risk_level)
       values ($1, $2, $3, $4, $5::uuid, null, null, null, null)
       on conflict (gate_key) do update
         set status = excluded.status,
             evidence_kind = excluded.evidence_kind,
             evidence_reference = excluded.evidence_reference,
             verified_by = excluded.verified_by,
             waiver_motivation = null,
             waiver_approved_by = null,
             waiver_expires_at = null,
             waiver_risk_level = null,
             updated_at = now()`,
      [
        input.gateKey,
        input.status,
        input.evidenceKind ?? null,
        input.evidenceReference ?? null,
        input.verifiedBy ?? null,
      ],
    );
  }

  /**
   * Formal waiver: required gates can only be bypassed with a documented
   * reason, approver, expiry date and risk level. Anything missing is refused.
   */
  async waiveGate(input: WaiverInput): Promise<void> {
    if (!input.reason?.trim()) throw new WaiverValidationError('Waiver requires a reason');
    if (!input.approverProfileId) throw new WaiverValidationError('Waiver requires an approver');
    if (!input.expiresAt || !/^\d{4}-\d{2}-\d{2}$/.test(input.expiresAt)) {
      throw new WaiverValidationError('Waiver requires an expiry date (YYYY-MM-DD)');
    }
    if (new Date(input.expiresAt) <= new Date()) {
      throw new WaiverValidationError('Waiver expiry must be in the future');
    }
    if (!['low', 'medium', 'high', 'critical'].includes(input.riskLevel)) {
      throw new WaiverValidationError('Waiver requires a risk level');
    }
    await this.db.query(
      `insert into production_readiness_evidence
         (gate_key, status, waiver_motivation, waiver_approved_by, waiver_expires_at, waiver_risk_level)
       values ($1, 'waived', $2, $3::uuid, $4, $5)
       on conflict (gate_key) do update
         set status = 'waived',
             waiver_motivation = excluded.waiver_motivation,
             waiver_approved_by = excluded.waiver_approved_by,
             waiver_expires_at = excluded.waiver_expires_at,
             waiver_risk_level = excluded.waiver_risk_level,
             updated_at = now()`,
      [input.gateKey, input.reason, input.approverProfileId, input.expiresAt, input.riskLevel],
    );
  }

  private gateSatisfied(gate: ReadinessGateWithEvidence): boolean {
    if (gate.status === 'passed') return true;
    if (gate.status === 'waived') {
      // Expired waivers no longer satisfy the gate (fail closed).
      return !!gate.waiverExpiresAt && new Date(gate.waiverExpiresAt) > new Date();
    }
    return false;
  }

  /** Go-live (production) is blocked while any required production gate is open. */
  async goLiveStatus(): Promise<{
    allowed: boolean;
    openRequiredGates: string[];
    waivedGates: string[];
  }> {
    const gates = await this.listGates('production');
    const required = gates.filter((g) => g.required);
    const open = required.filter((g) => !this.gateSatisfied(g));
    return {
      allowed: open.length === 0 && required.length > 0,
      openRequiredGates: open.map((g) => g.gateKey),
      waivedGates: gates.filter((g) => g.status === 'waived').map((g) => g.gateKey),
    };
  }

  /** Pilot has its own, smaller checklist. */
  async pilotStatus(): Promise<{
    allowed: boolean;
    openRequiredGates: string[];
    waivedGates: string[];
  }> {
    const gates = await this.listGates('pilot');
    const required = gates.filter((g) => g.required);
    const open = required.filter((g) => !this.gateSatisfied(g));
    return {
      allowed: open.length === 0 && required.length > 0,
      openRequiredGates: open.map((g) => g.gateKey),
      waivedGates: gates.filter((g) => g.status === 'waived').map((g) => g.gateKey),
    };
  }
}
