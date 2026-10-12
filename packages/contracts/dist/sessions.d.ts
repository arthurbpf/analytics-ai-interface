import { z } from "zod";
export declare const idSchema: z.ZodUUID;
export declare const terminalStatusSchema: z.ZodEnum<{
    completed: "completed";
    failed: "failed";
    interrupted: "interrupted";
}>;
export type TerminalStatus = z.infer<typeof terminalStatusSchema>;
export declare const turnStatusSchema: z.ZodEnum<{
    completed: "completed";
    failed: "failed";
    interrupted: "interrupted";
    running: "running";
}>;
export declare const apiErrorSchema: z.ZodObject<{
    code: z.ZodString;
    message: z.ZodString;
}, z.core.$strip>;
export type ApiError = z.infer<typeof apiErrorSchema>;
export declare const turnRequestSchema: z.ZodObject<{
    message: z.ZodString;
    clientTurnId: z.ZodUUID;
}, z.core.$strip>;
export declare const sessionSchema: z.ZodObject<{
    id: z.ZodUUID;
    createdAt: z.ZodISODateTime;
    updatedAt: z.ZodISODateTime;
}, z.core.$strip>;
export declare const turnSchema: z.ZodObject<{
    id: z.ZodUUID;
    clientTurnId: z.ZodUUID;
    status: z.ZodEnum<{
        completed: "completed";
        failed: "failed";
        interrupted: "interrupted";
        running: "running";
    }>;
    createdAt: z.ZodISODateTime;
    finishedAt: z.ZodNullable<z.ZodISODateTime>;
    error: z.ZodNullable<z.ZodObject<{
        code: z.ZodString;
        message: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const messageContentSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    kind: z.ZodLiteral<"user">;
    text: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"chart">;
    chart: z.ZodObject<{
        id: z.ZodUUID;
        spec: z.ZodDiscriminatedUnion<[z.ZodObject<{
            title: z.ZodString;
            resultRef: z.ZodUUID;
            x: z.ZodString;
            y: z.ZodString;
            type: z.ZodLiteral<"bar">;
        }, z.core.$strip>, z.ZodObject<{
            title: z.ZodString;
            resultRef: z.ZodUUID;
            x: z.ZodString;
            y: z.ZodString;
            type: z.ZodLiteral<"line">;
        }, z.core.$strip>, z.ZodObject<{
            title: z.ZodString;
            resultRef: z.ZodUUID;
            x: z.ZodString;
            y: z.ZodString;
            type: z.ZodLiteral<"stacked_bar">;
            series: z.ZodString;
        }, z.core.$strip>, z.ZodObject<{
            title: z.ZodString;
            resultRef: z.ZodUUID;
            type: z.ZodLiteral<"table">;
            columns: z.ZodArray<z.ZodString>;
        }, z.core.$strip>, z.ZodObject<{
            title: z.ZodString;
            resultRef: z.ZodUUID;
            type: z.ZodLiteral<"kpi">;
            column: z.ZodString;
            row: z.ZodNumber;
        }, z.core.$strip>], "type">;
        data: z.ZodObject<{
            columns: z.ZodArray<z.ZodObject<{
                name: z.ZodString;
                type: z.ZodEnum<{
                    boolean: "boolean";
                    date: "date";
                    number: "number";
                    string: "string";
                }>;
            }, z.core.$strip>>;
            rows: z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean, z.ZodNull]>>>;
            complete: z.ZodBoolean;
            totalRows: z.ZodString;
        }, z.core.$strip>;
    }, z.core.$strip>;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"analysis">;
    analysis: z.ZodObject<{
        narrative: z.ZodString;
        caveats: z.ZodArray<z.ZodString>;
        resultRefs: z.ZodArray<z.ZodUUID>;
        chartIds: z.ZodArray<z.ZodUUID>;
    }, z.core.$strip>;
}, z.core.$strip>], "kind">;
export type MessageContent = z.infer<typeof messageContentSchema>;
export declare const displayMessageSchema: z.ZodObject<{
    id: z.ZodUUID;
    turnId: z.ZodUUID;
    content: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"user">;
        text: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"chart">;
        chart: z.ZodObject<{
            id: z.ZodUUID;
            spec: z.ZodDiscriminatedUnion<[z.ZodObject<{
                title: z.ZodString;
                resultRef: z.ZodUUID;
                x: z.ZodString;
                y: z.ZodString;
                type: z.ZodLiteral<"bar">;
            }, z.core.$strip>, z.ZodObject<{
                title: z.ZodString;
                resultRef: z.ZodUUID;
                x: z.ZodString;
                y: z.ZodString;
                type: z.ZodLiteral<"line">;
            }, z.core.$strip>, z.ZodObject<{
                title: z.ZodString;
                resultRef: z.ZodUUID;
                x: z.ZodString;
                y: z.ZodString;
                type: z.ZodLiteral<"stacked_bar">;
                series: z.ZodString;
            }, z.core.$strip>, z.ZodObject<{
                title: z.ZodString;
                resultRef: z.ZodUUID;
                type: z.ZodLiteral<"table">;
                columns: z.ZodArray<z.ZodString>;
            }, z.core.$strip>, z.ZodObject<{
                title: z.ZodString;
                resultRef: z.ZodUUID;
                type: z.ZodLiteral<"kpi">;
                column: z.ZodString;
                row: z.ZodNumber;
            }, z.core.$strip>], "type">;
            data: z.ZodObject<{
                columns: z.ZodArray<z.ZodObject<{
                    name: z.ZodString;
                    type: z.ZodEnum<{
                        boolean: "boolean";
                        date: "date";
                        number: "number";
                        string: "string";
                    }>;
                }, z.core.$strip>>;
                rows: z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean, z.ZodNull]>>>;
                complete: z.ZodBoolean;
                totalRows: z.ZodString;
            }, z.core.$strip>;
        }, z.core.$strip>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"analysis">;
        analysis: z.ZodObject<{
            narrative: z.ZodString;
            caveats: z.ZodArray<z.ZodString>;
            resultRefs: z.ZodArray<z.ZodUUID>;
            chartIds: z.ZodArray<z.ZodUUID>;
        }, z.core.$strip>;
    }, z.core.$strip>], "kind">;
}, z.core.$strip>;
export declare const historySchema: z.ZodObject<{
    session: z.ZodObject<{
        id: z.ZodUUID;
        createdAt: z.ZodISODateTime;
        updatedAt: z.ZodISODateTime;
    }, z.core.$strip>;
    turns: z.ZodArray<z.ZodObject<{
        id: z.ZodUUID;
        clientTurnId: z.ZodUUID;
        status: z.ZodEnum<{
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
            running: "running";
        }>;
        createdAt: z.ZodISODateTime;
        finishedAt: z.ZodNullable<z.ZodISODateTime>;
        error: z.ZodNullable<z.ZodObject<{
            code: z.ZodString;
            message: z.ZodString;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    messages: z.ZodArray<z.ZodObject<{
        id: z.ZodUUID;
        turnId: z.ZodUUID;
        content: z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"user">;
            text: z.ZodString;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"chart">;
            chart: z.ZodObject<{
                id: z.ZodUUID;
                spec: z.ZodDiscriminatedUnion<[z.ZodObject<{
                    title: z.ZodString;
                    resultRef: z.ZodUUID;
                    x: z.ZodString;
                    y: z.ZodString;
                    type: z.ZodLiteral<"bar">;
                }, z.core.$strip>, z.ZodObject<{
                    title: z.ZodString;
                    resultRef: z.ZodUUID;
                    x: z.ZodString;
                    y: z.ZodString;
                    type: z.ZodLiteral<"line">;
                }, z.core.$strip>, z.ZodObject<{
                    title: z.ZodString;
                    resultRef: z.ZodUUID;
                    x: z.ZodString;
                    y: z.ZodString;
                    type: z.ZodLiteral<"stacked_bar">;
                    series: z.ZodString;
                }, z.core.$strip>, z.ZodObject<{
                    title: z.ZodString;
                    resultRef: z.ZodUUID;
                    type: z.ZodLiteral<"table">;
                    columns: z.ZodArray<z.ZodString>;
                }, z.core.$strip>, z.ZodObject<{
                    title: z.ZodString;
                    resultRef: z.ZodUUID;
                    type: z.ZodLiteral<"kpi">;
                    column: z.ZodString;
                    row: z.ZodNumber;
                }, z.core.$strip>], "type">;
                data: z.ZodObject<{
                    columns: z.ZodArray<z.ZodObject<{
                        name: z.ZodString;
                        type: z.ZodEnum<{
                            boolean: "boolean";
                            date: "date";
                            number: "number";
                            string: "string";
                        }>;
                    }, z.core.$strip>>;
                    rows: z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean, z.ZodNull]>>>;
                    complete: z.ZodBoolean;
                    totalRows: z.ZodString;
                }, z.core.$strip>;
            }, z.core.$strip>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"analysis">;
            analysis: z.ZodObject<{
                narrative: z.ZodString;
                caveats: z.ZodArray<z.ZodString>;
                resultRefs: z.ZodArray<z.ZodUUID>;
                chartIds: z.ZodArray<z.ZodUUID>;
            }, z.core.$strip>;
        }, z.core.$strip>], "kind">;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type SessionHistory = z.infer<typeof historySchema>;
