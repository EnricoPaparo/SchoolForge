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
export declare const STUDY_TEXT_LIMITS: {
    readonly capability: 500;
    readonly prerequisites: 1000;
    readonly method: 1500;
    readonly quoteMin: 20;
    readonly quoteMax: 1200;
    readonly hint: 1500;
    readonly plannedObjective: 300;
};
export declare const STUDY_PLAN_CONSTRAINTS: readonly ["shape", "keys", "coverage_count", "coverage_status", "coverage_evidence", "coverage_objectives", "objective_count", "step_count", "capability_text", "prerequisites_text", "method_text", "quote_text", "quote_not_found", "step_reference", "hint_text", "progression"];
export type StudyPlanConstraint = (typeof STUDY_PLAN_CONSTRAINTS)[number];
/** No source text, ordinals or arbitrary provider data are attached to this error. */
export declare class StudyPlanValidationError extends Error {
    readonly constraint: StudyPlanConstraint;
    constructor(constraint: StudyPlanConstraint, message: string);
}
export declare function buildStudyPlanSchema(questionCount?: number, plannedObjectives?: readonly string[], openQuestionCount?: number): {
    type: string;
    additionalProperties: boolean;
    required: string[];
    properties: {
        plannedCoverage: {
            type: string;
            minItems: number;
            maxItems: number;
            items: {
                type: string;
                additionalProperties: boolean;
                required: string[];
                properties: {
                    objective: {
                        enum?: string[] | undefined;
                        type: string;
                        minLength: number;
                        maxLength: number;
                    };
                    status: {
                        type: string;
                        enum: string[];
                    };
                    sourceQuote: {
                        anyOf: ({
                            type: string;
                            minLength: number;
                            maxLength: number;
                        } | {
                            type: string;
                        })[];
                    };
                };
            };
        };
        objectives: {
            type: string;
            minItems: number;
            maxItems: number;
            items: {
                type: string;
                additionalProperties: boolean;
                required: string[];
                properties: {
                    capability: {
                        type: string;
                        minLength: number;
                        maxLength: number;
                    };
                    prerequisites: {
                        type: string;
                        minLength: number;
                        maxLength: number;
                    };
                    method: {
                        type: string;
                        minLength: number;
                        maxLength: number;
                    };
                    sourceQuote: {
                        type: string;
                        minLength: number;
                        maxLength: number;
                    };
                };
            };
        };
        steps: {
            type: string;
            minItems: number;
            maxItems: number;
            items: {
                type: string;
                additionalProperties: boolean;
                required: string[];
                properties: {
                    questionOrder: {
                        type: string;
                        minimum: number;
                        maximum: number;
                    };
                    objectiveIndex: {
                        type: string;
                        minimum: number;
                        maximum: number;
                    };
                    stage: {
                        type: string;
                        enum: string[];
                    };
                    hints: {
                        type: string;
                        minItems: number;
                        maxItems: number;
                        items: {
                            type: string;
                            minLength: number;
                            maxLength: number;
                        };
                    };
                };
            };
        };
    };
};
/** General contract; provider generation uses the request-specific builder. */
export declare const STUDY_PLAN_SCHEMA: {
    type: string;
    additionalProperties: boolean;
    required: string[];
    properties: {
        plannedCoverage: {
            type: string;
            minItems: number;
            maxItems: number;
            items: {
                type: string;
                additionalProperties: boolean;
                required: string[];
                properties: {
                    objective: {
                        enum?: string[] | undefined;
                        type: string;
                        minLength: number;
                        maxLength: number;
                    };
                    status: {
                        type: string;
                        enum: string[];
                    };
                    sourceQuote: {
                        anyOf: ({
                            type: string;
                            minLength: number;
                            maxLength: number;
                        } | {
                            type: string;
                        })[];
                    };
                };
            };
        };
        objectives: {
            type: string;
            minItems: number;
            maxItems: number;
            items: {
                type: string;
                additionalProperties: boolean;
                required: string[];
                properties: {
                    capability: {
                        type: string;
                        minLength: number;
                        maxLength: number;
                    };
                    prerequisites: {
                        type: string;
                        minLength: number;
                        maxLength: number;
                    };
                    method: {
                        type: string;
                        minLength: number;
                        maxLength: number;
                    };
                    sourceQuote: {
                        type: string;
                        minLength: number;
                        maxLength: number;
                    };
                };
            };
        };
        steps: {
            type: string;
            minItems: number;
            maxItems: number;
            items: {
                type: string;
                additionalProperties: boolean;
                required: string[];
                properties: {
                    questionOrder: {
                        type: string;
                        minimum: number;
                        maximum: number;
                    };
                    objectiveIndex: {
                        type: string;
                        minimum: number;
                        maximum: number;
                    };
                    stage: {
                        type: string;
                        enum: string[];
                    };
                    hints: {
                        type: string;
                        minItems: number;
                        maxItems: number;
                        items: {
                            type: string;
                            minLength: number;
                            maxLength: number;
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