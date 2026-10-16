/** Additive study contract. Source quotations are evidence, not proof of pedagogical validity. */
export interface StudyObjective {
    capability: string;
    prerequisites: string;
    method: string;
    sourceQuote: string;
}
export type StudyStage = 'esempio' | 'guidato' | 'autonomo' | 'trasferimento';
export interface StudyStep {
    questionOrder: number;
    objectiveIndex: number;
    stage: StudyStage;
    hints: string[];
}
export interface StudyCoverage {
    objective: string;
    status: 'preparato' | 'parziale' | 'non_sviluppato';
    sourceQuote: string | null;
}
export interface StudyPlan {
    objectives: StudyObjective[];
    steps: StudyStep[];
    plannedCoverage: StudyCoverage[];
}
export declare const STUDY_PLAN_SCHEMA: {
    readonly type: "object";
    readonly additionalProperties: false;
    readonly required: readonly ["objectives", "steps", "plannedCoverage"];
    readonly properties: {
        readonly plannedCoverage: {
            readonly type: "array";
            readonly maxItems: 40;
            readonly items: {
                readonly type: "object";
                readonly additionalProperties: false;
                readonly required: readonly ["objective", "status", "sourceQuote"];
                readonly properties: {
                    readonly objective: {
                        type: string;
                    };
                    readonly status: {
                        readonly type: "string";
                        readonly enum: readonly ["preparato", "parziale", "non_sviluppato"];
                    };
                    readonly sourceQuote: {
                        readonly type: readonly ["string", "null"];
                    };
                };
            };
        };
        readonly objectives: {
            readonly type: "array";
            readonly minItems: 1;
            readonly maxItems: 4;
            readonly items: {
                readonly type: "object";
                readonly additionalProperties: false;
                readonly required: readonly ["capability", "prerequisites", "method", "sourceQuote"];
                readonly properties: {
                    readonly capability: {
                        type: string;
                    };
                    readonly prerequisites: {
                        type: string;
                    };
                    readonly method: {
                        type: string;
                    };
                    readonly sourceQuote: {
                        type: string;
                    };
                };
            };
        };
        readonly steps: {
            readonly type: "array";
            readonly minItems: 3;
            readonly maxItems: 12;
            readonly items: {
                readonly type: "object";
                readonly additionalProperties: false;
                readonly required: readonly ["questionOrder", "objectiveIndex", "stage", "hints"];
                readonly properties: {
                    readonly questionOrder: {
                        readonly type: "integer";
                        readonly minimum: 0;
                        readonly maximum: 11;
                    };
                    readonly objectiveIndex: {
                        readonly type: "integer";
                        readonly minimum: 0;
                        readonly maximum: 3;
                    };
                    readonly stage: {
                        readonly type: "string";
                        readonly enum: readonly ["esempio", "guidato", "autonomo", "trasferimento"];
                    };
                    readonly hints: {
                        readonly type: "array";
                        readonly minItems: 2;
                        readonly maxItems: 3;
                        readonly items: {
                            type: string;
                        };
                    };
                };
            };
        };
    };
};
export declare function validateStudyPlan(value: unknown, source: string, questionCount: number, plannedObjectives?: readonly string[]): StudyPlan;
export interface PoolCoverageSummary {
    coveredCapabilities: string[];
    gaps: string[];
    advancedOrdinals: number[];
}
export declare const POOL_COVERAGE_SCHEMA: {
    readonly type: "object";
    readonly additionalProperties: false;
    readonly required: readonly ["coveredCapabilities", "gaps", "advancedOrdinals"];
    readonly properties: {
        readonly coveredCapabilities: {
            readonly type: "array";
            readonly maxItems: 40;
            readonly items: {
                readonly type: "string";
            };
        };
        readonly gaps: {
            readonly type: "array";
            readonly maxItems: 40;
            readonly items: {
                readonly type: "string";
            };
        };
        readonly advancedOrdinals: {
            readonly type: "array";
            readonly maxItems: 30;
            readonly items: {
                readonly type: "integer";
                readonly minimum: 0;
                readonly maximum: 29;
            };
        };
    };
};
export declare function validatePoolCoverage(value: unknown, questionCount: number): PoolCoverageSummary;
//# sourceMappingURL=study.d.ts.map