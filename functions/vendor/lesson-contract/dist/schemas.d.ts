import { z } from 'zod';
export declare const QuestionSchema: z.ZodDiscriminatedUnion<"tipo", [z.ZodObject<{
    id: z.ZodString;
    difficolta: z.ZodNumber;
    testo: z.ZodString;
} & {
    tipo: z.ZodLiteral<"aperta">;
    soluzione: z.ZodString;
    maxCharacters: z.ZodDefault<z.ZodNumber>;
}, "strict", z.ZodTypeAny, {
    id: string;
    testo: string;
    difficolta: number;
    tipo: "aperta";
    soluzione: string;
    maxCharacters: number;
}, {
    id: string;
    testo: string;
    difficolta: number;
    tipo: "aperta";
    soluzione: string;
    maxCharacters?: number | undefined;
}>, z.ZodObject<{
    id: z.ZodString;
    difficolta: z.ZodNumber;
    testo: z.ZodString;
} & {
    tipo: z.ZodLiteral<"chiusa_singola">;
    opzioni: z.ZodEffects<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        testo: z.ZodString;
    }, "strict", z.ZodTypeAny, {
        id: string;
        testo: string;
    }, {
        id: string;
        testo: string;
    }>, "many">, {
        id: string;
        testo: string;
    }[], {
        id: string;
        testo: string;
    }[]>;
    soluzione: z.ZodArray<z.ZodString, "many">;
}, "strict", z.ZodTypeAny, {
    id: string;
    testo: string;
    difficolta: number;
    tipo: "chiusa_singola";
    soluzione: string[];
    opzioni: {
        id: string;
        testo: string;
    }[];
}, {
    id: string;
    testo: string;
    difficolta: number;
    tipo: "chiusa_singola";
    soluzione: string[];
    opzioni: {
        id: string;
        testo: string;
    }[];
}>, z.ZodObject<{
    id: z.ZodString;
    difficolta: z.ZodNumber;
    testo: z.ZodString;
} & {
    tipo: z.ZodLiteral<"chiusa_multipla">;
    opzioni: z.ZodEffects<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        testo: z.ZodString;
    }, "strict", z.ZodTypeAny, {
        id: string;
        testo: string;
    }, {
        id: string;
        testo: string;
    }>, "many">, {
        id: string;
        testo: string;
    }[], {
        id: string;
        testo: string;
    }[]>;
    soluzione: z.ZodArray<z.ZodString, "many">;
}, "strict", z.ZodTypeAny, {
    id: string;
    testo: string;
    difficolta: number;
    tipo: "chiusa_multipla";
    soluzione: string[];
    opzioni: {
        id: string;
        testo: string;
    }[];
}, {
    id: string;
    testo: string;
    difficolta: number;
    tipo: "chiusa_multipla";
    soluzione: string[];
    opzioni: {
        id: string;
        testo: string;
    }[];
}>]>;
export declare const PoolFrontMatterSchema: z.ZodObject<{
    schema: z.ZodLiteral<"schoolforge-pool/v2">;
    questions: z.ZodArray<z.ZodDiscriminatedUnion<"tipo", [z.ZodObject<{
        id: z.ZodString;
        difficolta: z.ZodNumber;
        testo: z.ZodString;
    } & {
        tipo: z.ZodLiteral<"aperta">;
        soluzione: z.ZodString;
        maxCharacters: z.ZodDefault<z.ZodNumber>;
    }, "strict", z.ZodTypeAny, {
        id: string;
        testo: string;
        difficolta: number;
        tipo: "aperta";
        soluzione: string;
        maxCharacters: number;
    }, {
        id: string;
        testo: string;
        difficolta: number;
        tipo: "aperta";
        soluzione: string;
        maxCharacters?: number | undefined;
    }>, z.ZodObject<{
        id: z.ZodString;
        difficolta: z.ZodNumber;
        testo: z.ZodString;
    } & {
        tipo: z.ZodLiteral<"chiusa_singola">;
        opzioni: z.ZodEffects<z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            testo: z.ZodString;
        }, "strict", z.ZodTypeAny, {
            id: string;
            testo: string;
        }, {
            id: string;
            testo: string;
        }>, "many">, {
            id: string;
            testo: string;
        }[], {
            id: string;
            testo: string;
        }[]>;
        soluzione: z.ZodArray<z.ZodString, "many">;
    }, "strict", z.ZodTypeAny, {
        id: string;
        testo: string;
        difficolta: number;
        tipo: "chiusa_singola";
        soluzione: string[];
        opzioni: {
            id: string;
            testo: string;
        }[];
    }, {
        id: string;
        testo: string;
        difficolta: number;
        tipo: "chiusa_singola";
        soluzione: string[];
        opzioni: {
            id: string;
            testo: string;
        }[];
    }>, z.ZodObject<{
        id: z.ZodString;
        difficolta: z.ZodNumber;
        testo: z.ZodString;
    } & {
        tipo: z.ZodLiteral<"chiusa_multipla">;
        opzioni: z.ZodEffects<z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            testo: z.ZodString;
        }, "strict", z.ZodTypeAny, {
            id: string;
            testo: string;
        }, {
            id: string;
            testo: string;
        }>, "many">, {
            id: string;
            testo: string;
        }[], {
            id: string;
            testo: string;
        }[]>;
        soluzione: z.ZodArray<z.ZodString, "many">;
    }, "strict", z.ZodTypeAny, {
        id: string;
        testo: string;
        difficolta: number;
        tipo: "chiusa_multipla";
        soluzione: string[];
        opzioni: {
            id: string;
            testo: string;
        }[];
    }, {
        id: string;
        testo: string;
        difficolta: number;
        tipo: "chiusa_multipla";
        soluzione: string[];
        opzioni: {
            id: string;
            testo: string;
        }[];
    }>]>, "many">;
}, "strict", z.ZodTypeAny, {
    schema: "schoolforge-pool/v2";
    questions: ({
        id: string;
        testo: string;
        difficolta: number;
        tipo: "aperta";
        soluzione: string;
        maxCharacters: number;
    } | {
        id: string;
        testo: string;
        difficolta: number;
        tipo: "chiusa_singola";
        soluzione: string[];
        opzioni: {
            id: string;
            testo: string;
        }[];
    } | {
        id: string;
        testo: string;
        difficolta: number;
        tipo: "chiusa_multipla";
        soluzione: string[];
        opzioni: {
            id: string;
            testo: string;
        }[];
    })[];
}, {
    schema: "schoolforge-pool/v2";
    questions: ({
        id: string;
        testo: string;
        difficolta: number;
        tipo: "aperta";
        soluzione: string;
        maxCharacters?: number | undefined;
    } | {
        id: string;
        testo: string;
        difficolta: number;
        tipo: "chiusa_singola";
        soluzione: string[];
        opzioni: {
            id: string;
            testo: string;
        }[];
    } | {
        id: string;
        testo: string;
        difficolta: number;
        tipo: "chiusa_multipla";
        soluzione: string[];
        opzioni: {
            id: string;
            testo: string;
        }[];
    })[];
}>;
//# sourceMappingURL=schemas.d.ts.map